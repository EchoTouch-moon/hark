import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RuntimeModeSchema } from '@hearth/contracts';
import { apiFetch } from './api/client';
import { ErrorState } from '../components/ErrorState';

type RuntimeState = { status: 'loading' } | { status: 'ready'; demoMode: boolean } | { status: 'error'; message: string };
const RuntimeContext = createContext<{state: RuntimeState; retry: () => void} | null>(null);
export function RuntimeModeProvider({children}: {children: ReactNode}) {
  const [state,setState]=useState<RuntimeState>({status:'loading'});
  const [revision,setRevision]=useState(0);
  const retry=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    const controller=new AbortController();
    setState({status:'loading'});
    void apiFetch<unknown>('/api/v1/health',{signal:controller.signal}).then(raw=>{
      const mode=RuntimeModeSchema.parse(raw);
      if(!controller.signal.aborted)setState({status:'ready',demoMode:mode.demoMode});
    }).catch(()=>{if(!controller.signal.aborted)setState({status:'error',message:'无法确认服务端运行模式，请重试。'});});
    return ()=>controller.abort();
  },[revision]);
  const value=useMemo(()=>({state,retry}),[state,retry]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}
export function useRuntimeMode() {
  const context=useContext(RuntimeContext);
  if(!context)throw new Error('缺少服务端模式上下文');
  return context;
}
export function RuntimeReady({children}:{children:ReactNode}) {
  const {state,retry}=useRuntimeMode();
  if(state.status==='loading')return <p role="status">正在确认运行模式…</p>;
  if(state.status==='error')return <ErrorState message={state.message} onRetry={retry}/>;
  return <>{children}</>;
}
