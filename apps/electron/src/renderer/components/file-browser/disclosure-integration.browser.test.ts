import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../test-utils/visual-renderer'

let renderer: VisualRendererHarness
beforeAll(async () => {
  renderer = await createVisualRendererHarness(`
    import React from 'react';import{createRoot}from'react-dom/client';import{Provider,createStore}from'jotai';
    import{TooltipProvider}from'@/components/ui/tooltip';import{FileBrowser}from'@/components/file-browser/FileBrowser';import{ContentBlock}from'@/components/agent/ContentBlock';import'@/styles/globals.css';
    const base='/fixture-'+Math.random(),calls=[];localStorage.clear();
    const file=(name,parent=base,dir=false)=>({name,path:parent+'/'+name,isDirectory:dir,size:1,modifiedAt:0});
    window.electronAPI={listDirectory:async p=>{calls.push(p);return p===base?[file('Alpha',base,true),file('Beta',base,true),file('说明.md')]:[file('child.md',p)]},getSettings:async()=>({})};
    const store=createStore();
    createRoot(document.getElementById('root')).render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement('main',{style:{width:480,padding:16}},
      React.createElement('section',{id:'files'},React.createElement(FileBrowser,{rootPath:base,embedded:true,hideToolbar:true})),
      React.createElement('section',{id:'agent-block'},React.createElement(ContentBlock,{block:{type:'tool_use',id:'agent-1',name:'Agent',input:{description:'审查交互',prompt:'只读审查'}},allMessages:[],childBlocks:[{type:'text',text:'子Agent正文'}]}))
    ))));
    window.foldIntegration={calls,base,wait:async(p)=>{for(let i=0;i<150;i++){if(p())return;await new Promise(r=>setTimeout(r,20))}throw Error('等待目录/内容超时 '+document.body.innerText)},pause:()=>new Promise(r=>setTimeout(r,200)),arrow:(name)=>document.querySelector('#files button[aria-label="展开目录 '+name+'"],#files button[aria-label="收起目录 '+name+'"]')};
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实目录及子Agent内容折叠', () => {
  test('When 用Cmd或Ctrl点击目录箭头 Then 保留多选语义而不展开或请求子目录', async () => {
    const result = await renderer.run<{states:string[];loads:number}>(`
      const f=window.foldIntegration;await f.wait(()=>f.arrow('Alpha'));const states=[];
      for(const modifier of ['metaKey','ctrlKey']){f.arrow('Alpha').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,[modifier]:true}));await f.pause();states.push(f.arrow('Alpha').getAttribute('aria-expanded'))}
      return{states,loads:f.calls.filter(p=>p.endsWith('/Alpha')).length};
    `)
    expect(result).toEqual({states:['false','false'],loads:0})
  })

  test('When 点击原生目录按钮并聚焦 Then 只展开一次、可键盘访问且槽位不改变名称位置', async () => {
    const result = await renderer.run<{native:boolean;open:string;loads:number;beforeX:number;afterX:number;rowHeight:number;width:number;focus:boolean}>(`
      const f=window.foldIntegration;await f.wait(()=>f.arrow('Beta'));const button=f.arrow('Beta'),row=button.closest('.file-tree-row'),beforeX=row.querySelector('.gamma-fade-title').getBoundingClientRect().x;
      button.focus();button.click();await f.wait(()=>button.getAttribute('aria-expanded')==='true');await f.pause();
      return{native:button.tagName==='BUTTON'&&button.type==='button'&&button.tabIndex===0,open:button.getAttribute('aria-expanded'),loads:f.calls.filter(p=>p.endsWith('/Beta')).length,beforeX,afterX:row.querySelector('.gamma-fade-title').getBoundingClientRect().x,rowHeight:row.getBoundingClientRect().height,width:button.getBoundingClientRect().width,focus:document.activeElement===button};
    `, {keyboard:true})
    expect(result).toMatchObject({native:true,open:'true',loads:1,rowHeight:34,width:14,focus:true})
    expect(result.afterX).toBe(result.beforeX)
  })

  test('When 展开子Agent后查看底部收起入口 Then 始终显示90度箭头并且收起仍有效', async () => {
    const result = await renderer.run<{visible:string;expanded:string;angle:number;collapsed:boolean}>(`
      const f=window.foldIntegration;await f.wait(()=>document.querySelector('#agent-block button[aria-expanded]'));document.querySelector('#agent-block button[aria-expanded]').click();
      await f.wait(()=>Array.from(document.querySelectorAll('#agent-block button')).some(b=>b.textContent.trim()==='收起'));await f.pause();
      const button=Array.from(document.querySelectorAll('#agent-block button')).find(b=>b.textContent.trim()==='收起'),svg=button.querySelector('svg'),s=getComputedStyle(svg),m=new DOMMatrix(s.transform),angle=Math.round(Math.atan2(m.b,m.a)*180/Math.PI),visible=s.opacity,expanded=button.getAttribute('aria-expanded');
      button.click();await f.wait(()=>!Array.from(document.querySelectorAll('#agent-block button')).some(b=>b.textContent.trim()==='收起'));return{visible,expanded,angle,collapsed:document.querySelector('#agent-block button[aria-expanded]').getAttribute('aria-expanded')==='false'};
    `)
    expect(result).toEqual({visible:'1',expanded:'true',angle:90,collapsed:true})
  })
})
