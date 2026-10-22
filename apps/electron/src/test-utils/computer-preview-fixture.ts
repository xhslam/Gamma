/** 临时预览窗的独立 renderer fixture；不读取用户屏幕或会话。 */
export const computerPreviewFixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ComputerUsePreview, mergeComputerPreview } from '@/components/computer-use/ComputerUsePreview'
import '@/styles/globals.css'
window.mergePreview = mergeComputerPreview
Object.defineProperty(document,'hidden',{value:false,configurable:true})
window.until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('未达到预期DOM状态')}
window.mount=async (image)=>{
 window.reads=[];window.stops=[];window.failRead=false;window.failStop=false;window.blockRead=false;window.listeners=[]
 window.preview={sessionId:'s1',runId:'run1',phase:'active',mode:'live',appName:'Safari',frame:{frameId:'video1',capturedAt:1792634640000,width:1280,height:800,dataUrl:image||document.createElement('canvas').toDataURL('image/jpeg')},activities:[{id:'a1',action:'get_app_state',status:'returned',startedAt:1},{id:'a2',action:'click',status:'running',startedAt:2}]}
 window.electronAPI={
  getComputerPreview:async({sessionId,frameId:known,live})=>{
   window.reads.push({sessionId,live})
   if(!live)return window.preview&&sessionId===window.preview.sessionId?{...window.preview,frame:undefined,mode:'paused'}:null
   if(window.failRead)throw Error('断连')
   const value=sessionId===window.preview?.sessionId?structuredClone(window.preview):null
   if(value?.frame?.frameId===known)delete value.frame.dataUrl
   if(window.blockRead)await new Promise(resolve=>window.releaseRead=resolve)
   return value
  },
  stopComputerPreview:async(sessionId,runId)=>{window.stops.push({sessionId,runId});if(window.failStop)throw Error('停止失败');window.preview=null;window.listeners.forEach(fn=>fn({sessionId,phase:'disabled'}));return {phase:'disabled'}},
  onComputerStateChanged:fn=>{window.listeners.push(fn);return()=>{window.listeners=window.listeners.filter(v=>v!==fn)}}
 }
 window.root=createRoot(document.getElementById('root'))
 window.select=sessionId=>window.root.render(React.createElement(ComputerUsePreview,{sessionId,key:sessionId}))
 window.select('s1')
 await window.until(()=>document.querySelector('img'))
}
`
