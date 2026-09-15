# Adapted from flexi767/agentpulse 04f0dcf42d700f60ea3848326ba6d43da80c7a40.
# Copyright (c) 2026 Jay Stuart; MIT, see AGENTPULSE-LICENSE.
#!/usr/bin/env python3
"""Incremental native turn results; never inspect a shared checkout for attribution."""
import difflib
import hashlib
import json

FIELDS = {'inputTokens':'input_tokens','cachedInputTokens':'cached_input_tokens','cacheWriteTokens':'cache_write_input_tokens','outputTokens':'output_tokens','reasoningTokens':'reasoning_output_tokens'}
def known(v): return v if isinstance(v,int) and not isinstance(v,bool) and 0<=v<=9007199254740991 else None
def num(v): return known(v) or 0
def total(*values): return sum(values) if all(v is not None for v in values) else None
def maximum(a,b): return max(a,b) if a is not None and b is not None else a if a is not None else b
def text(content):
    if isinstance(content,str): return content
    return '\n'.join(b.get('text','') for b in content or [] if isinstance(b,dict) and b.get('type','').lower() in ('text','input_text','output_text'))
def fresh(tid,at):
    return {'id':tid,'startedAt':at,'completedAt':None,'durationMs':None,'durationSource':'timestamps','prompts':[],'response':'','usage':[],'files':[],'toolCalls':0,'updatedAt':at}
def claude_turn_finished(message):
    content=message.get('content') or []
    if isinstance(content,list) and any(isinstance(block,dict) and block.get('type')=='tool_use' for block in content):return False
    return message.get('stop_reason') in ('end_turn','stop_sequence','max_tokens')
def consume(state,e,agent):
    p=e.get('payload') or {}; at=e.get('timestamp')
    if not isinstance(p,dict) or not isinstance(at,str): return
    kind=e.get('type'); sub=p.get('type'); turns=state.setdefault('turns',{}); changed=state.setdefault('changed',[])
    def turn(tid=None):
        tid=tid or state.get('active') or ('inferred:'+at)
        if tid not in turns: turns[tid]=fresh(tid,at)
        if not state.get('active'):state['active']=tid
        r=turns[tid]; r['updatedAt']=max(r['updatedAt'],at)
        if tid not in changed: changed.append(tid)
        return r
    def event_key(native=None):
        return str(native) if native is not None else hashlib.sha256(json.dumps(e,sort_keys=True).encode()).hexdigest()
    def prompt(value,tid=None,key=None):
        if not value.strip(): return
        seen=state.setdefault('promptEvents',{})
        key=key or event_key(e.get('uuid') or p.get('id'))
        if key in seen:return
        seen[key]=True
        r=turn(tid)
        r['prompts'].append(value[:65536])
    def edit(r,path,diff,key):
        seen=state.setdefault('edits',{})
        key=r['id']+':'+str(key)
        if key in seen: return
        seen[key]=True
        f=next((f for f in r['files'] if f['path']==path),None)
        if not f:
            if len(r['files'])>=256:return
            f={'path':path,'diff':'','added':0,'removed':0,'truncated':False};r['files'].append(f)
        f['added']+=sum(l.startswith('+') and not l.startswith('+++') for l in diff.splitlines())
        f['removed']+=sum(l.startswith('-') and not l.startswith('---') for l in diff.splitlines())
        combined=f['diff']+'\n'+diff
        f['truncated']=f['truncated'] or len(combined)>65536;f['diff']=combined[:65536]
    if kind=='turn_context':
        state['model']=p.get('model') or state.get('model');state['serviceTier']=p.get('service_tier');state['fast']=p.get('service_tier') in ('fast','priority');return
    if kind=='event_msg' and sub=='task_started':
        r=turn(p.get('turn_id'))
        if at>=state.get('activeStartedAt',''):
            state['active']=r['id'];state['activeStartedAt']=at
        return
    if kind=='event_msg' and sub in ('task_complete','task_completed','turn_aborted'):
        r=turn(p.get('turn_id'));r['completedAt']=at
        r['durationMs']=num(p.get('duration_ms')) if p.get('duration_ms') is not None else elapsed(r['startedAt'],at)
        r['durationSource']='provider' if p.get('duration_ms') is not None else 'timestamps'
        if p.get('last_agent_message'):r['response']=p['last_agent_message'][:131072]
        return
    if kind=='response_item' and sub=='message':
        value=text(p.get('content'))
        if p.get('role')=='user' and not state.get('nativePrompts',{}).get(state.get('active')):prompt(value)
        elif p.get('role')=='assistant' and p.get('phase')=='final':turn()['response']=value[:131072]
        return
    if kind=='event_msg' and sub=='item_completed':
        i=p.get('item') or {}; typ=i.get('type');r=turn(p.get('turn_id'))
        if typ=='UserMessage':
            native=state.setdefault('nativePrompts',{})
            if not native.get(r['id']):r['prompts']=[];native[r['id']]=True
            prompt(text(i.get('content')),r['id'],key='native:'+r['id']+':'+event_key(i.get('id')))
        elif typ=='AgentMessage' and i.get('phase')=='final':r['response']=text(i.get('content'))[:131072]
        elif typ=='FileChange':
            changes=i.get('changes') or {}
            if isinstance(changes,dict):
                for path,c in changes.items():
                    if isinstance(c,dict):
                        diff=c.get('unified_diff') or c.get('diff') or ''
                        if not diff and isinstance(c.get('content'),str):
                            prefix='-' if c.get('type')=='delete' else '+'
                            diff=f'--- {path}\n+++ {path}\n'+''.join(prefix+line+'\n' for line in c['content'].splitlines())
                        edit(r,path,diff,event_key(i.get('id'))+':'+path)
        elif typ in ('CommandExecution','McpToolCall'):
            key=r['id']+':'+event_key(i.get('id'))
            seen=state.setdefault('toolEvents',{})
            if key not in seen:r['toolCalls']+=1;seen[key]=True
        return
    if kind=='token_usage_record':
        tid=p.get('turn_id') or state.get('active');r=turn(tid)
        key=str(tid)+':'+event_key(p.get('response_id') or e.get('ordinal'))
        u=p.get('usage') or {};req={k:known(u.get(v)) for k,v in FIELDS.items()};req['cacheWriteTokens']=0
        req.update({'cacheWriteHourTokens':0,'model':state.get('model') or 'Unknown','longContext':num(u.get('input_tokens'))>272000,'fast':state.get('fast',False),'serviceTier':state.get('serviceTier'),'contextTokens':known(u.get('input_tokens')),'requests':1,'turn':tid})
        previous=state.setdefault('requests',{}).get(key)
        if previous:
            for k in FIELDS:req[k]=maximum(req[k],previous[k])
        state['requests'][key]=req;rebuild_usage(state,r);return
    if kind=='event_msg' and sub=='token_count':
        info=p.get('info') or {};u=info.get('total_token_usage')
        if not isinstance(u,dict):return
        prev=state.get('previousUsage',{});state['previousUsage']=u
        if any(request['turn']==state.get('active') for request in state.get('requests',{}).values()):return
        delta={k:(max(0,u[v]-num(prev.get(v))) if known(u.get(v)) is not None else None) for k,v in FIELDS.items()}
        delta['cacheWriteTokens']=0
        if not any(value for value in delta.values() if value is not None):return
        r=turn();last=info.get('last_token_usage') or {};delta.update({'cacheWriteHourTokens':0,'model':state.get('model') or 'Unknown','longContext':num(last.get('input_tokens'))>272000,'fast':state.get('fast',False),'serviceTier':state.get('serviceTier'),'contextTokens':known(last.get('input_tokens')),'requests':1,'turn':r['id']})
        state.setdefault('fallback',{}).setdefault(r['id'],[]).append(delta);rebuild_usage(state,r);return
    if agent!='claude_code':return
    m=e.get('message') or {}
    if not isinstance(m,dict):return
    content=m.get('content') or []
    if kind=='user':
        value=text(content)
        if value and not e.get('isMeta') and event_key(e.get('uuid')) not in state.get('promptEvents',{}):
            # User steering belongs to the active unfinished turn.
            active=turns.get(state.get('active'))
            if not active or active['completedAt']:state['active']=e.get('uuid') or 'claude:'+at
            prompt(value)
        if isinstance(content,list):
            for b in content:
                if not isinstance(b,dict) or b.get('type')!='tool_result' or b.get('is_error'):continue
                call=state.setdefault('calls',{}).get(b.get('tool_use_id'))
                if not call:continue
                inp=call['input'];path=inp.get('file_path') or inp.get('path')
                if path and call['name'] in ('Edit','Write','MultiEdit'):
                    r=turn(call['turn']);patch=e.get('toolUseResult') or {};diff=''
                    if isinstance(patch,dict) and isinstance(patch.get('structuredPatch'),list):
                        for h in patch['structuredPatch']:
                            diff+=f"@@ -{h.get('oldStart',0)},{h.get('oldLines',0)} +{h.get('newStart',0)},{h.get('newLines',0)} @@\n"+'\n'.join(h.get('lines') or [])+'\n'
                    if not diff:
                        edits=inp.get('edits') or [inp]
                        for change in edits:
                            old=change.get('old_string','');new=change.get('new_string',change.get('content',''))
                            diff+=''.join(difflib.unified_diff([line+'\n' for line in old.splitlines()],[line+'\n' for line in new.splitlines()],fromfile=path,tofile=path))
                    edit(r,path,diff,b.get('tool_use_id'))
        return
    if kind=='assistant':
        r=turn();value=text(content)
        if value:r['response']=value[:131072]
        if claude_turn_finished(m):r['completedAt']=at;r['durationMs']=elapsed(r['startedAt'],at)
        else:r['completedAt']=None;r['durationMs']=None
        for b in content if isinstance(content,list) else []:
            if isinstance(b,dict) and b.get('type')=='tool_use':
                r['completedAt']=None;r['durationMs']=None
                if b.get('id') not in state.setdefault('calls',{}):r['toolCalls']+=1
                state['calls'][b.get('id')]={'name':b.get('name'),'input':b.get('input') or {},'turn':r['id']}
        u=m.get('usage')
        if isinstance(u,dict):
            key=r['id']+':'+event_key(m.get('id') or e.get('uuid'));cr=known(u.get('cache_read_input_tokens'));cw=known(u.get('cache_creation_input_tokens'));cache=u.get('cache_creation') or {};inclusive=total(known(u.get('input_tokens')),cr,cw)
            req={'inputTokens':inclusive,'cachedInputTokens':cr,'cacheWriteTokens':cw,'cacheWriteHourTokens':known(cache.get('ephemeral_1h_input_tokens')) if cw != 0 else 0,'outputTokens':known(u.get('output_tokens')),'reasoningTokens':0,'model':m.get('model') or 'Unknown','requests':1,'turn':r['id'],'contextTokens':inclusive,'fast':u.get('speed')=='fast','serviceTier':u.get('speed'),'longContext':(inclusive or 0)>200000}
            prev=state.setdefault('requests',{}).get(key)
            if prev:
                for k in FIELDS:req[k]=maximum(req[k],prev[k])
                req['cacheWriteHourTokens']=maximum(req['cacheWriteHourTokens'],prev['cacheWriteHourTokens'])
            state['requests'][key]=req;rebuild_usage(state,r)
    if kind=='system' and e.get('subtype')=='turn_duration':
        r=turn();r['durationMs']=num(e.get('durationMs'));r['durationSource']='provider';r['completedAt']=at

def elapsed(start,end):
    from datetime import datetime
    try:return max(0,round((datetime.fromisoformat(end.replace('Z','+00:00'))-datetime.fromisoformat(start.replace('Z','+00:00'))).total_seconds()*1000))
    except ValueError:return None

def rebuild_usage(state,r):
    reqs=[u for u in state.get('requests',{}).values() if u['turn']==r['id']]
    if not reqs:reqs=state.get('fallback',{}).get(r['id'],[])
    grouped={}
    for u in reqs:
        key=(u['model'],u['longContext'],u['fast'],u.get('serviceTier'))
        if key not in grouped:grouped[key]={k:v for k,v in u.items() if k!='turn'}
        else:
            g=grouped[key]
            for k in (*FIELDS,'cacheWriteHourTokens','requests'):g[k]=total(g[k],u[k])
            g['contextTokens']=u['contextTokens']
    r['usage']=list(grouped.values())
