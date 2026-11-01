import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../test-utils/visual-renderer'

let renderer: VisualRendererHarness
beforeAll(async () => {
  renderer = await createVisualRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider, createStore } from 'jotai';
    import { TooltipProvider } from '@/components/ui/tooltip';
    import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
    import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap';
    import { SDKMessageRenderer } from '@/components/agent/SDKMessageRenderer';
    import { userProfileAtom } from '@/atoms/user-profile';
    import { useStickToBottomContext } from 'use-stick-to-bottom';
    import '@/styles/globals.css';
    const store = createStore();
    store.set(userProfileAtom, {userName:'不应显示的用户名',avatar:''});
    const items = Array.from({length:12},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',preview:'历史消息 '+i}));
    function Controls(){ window.context = useStickToBottomContext(); return React.createElement(ScrollMinimap,{items}); }
    function Fixture(){
      const [long,setLong]=React.useState(true);window.setLong=setLong;
      return React.createElement(Provider,{store},React.createElement(TooltipProvider,null,
        React.createElement('div',{id:'user-message'},React.createElement(SDKMessageRenderer,{message:{type:'user',uuid:'user-1',_createdAt:1793536200000,message:{role:'user',content:[{type:'text',text:'只保留这条发言'}]}}})),
        React.createElement('div',{id:'assistant-message'},React.createElement(SDKMessageRenderer,{message:{type:'assistant',uuid:'assistant-1',_createdAt:1793536200000,message:{role:'assistant',model:'gpt-6.1-sol',content:[{type:'text',text:'助手消息保持原样'}]}}})),
        React.createElement(Conversation,{id:'conversation',style:{height:400,width:700,flex:'none'}},
          React.createElement(ConversationContent,null,items.map((item,i)=>React.createElement('div',{key:item.id,'data-message-id':item.id,style:{height:long?180:4}},item.preview))),
          React.createElement(Controls))));
    }
    window.wait=(ms=100)=>new Promise(r=>setTimeout(r,ms));
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `)
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 精简后的会话界面', () => {
  test('When 渲染用户发言 Then 保留右对齐内容与操作但不显示身份及时间', async () => {
    const result = await renderer.run(`
      await window.wait(300);
      const message=document.querySelector('#user-message');
      return {text:message.textContent.includes('只保留这条发言'),name:message.textContent.includes('不应显示的用户名'),
        avatar:!!message.querySelector('img'),time:!!message.querySelector('.message-time'),
        right:message.querySelector('.is-user').className.includes('items-end'),copy:!!message.querySelector('button')};
    `)
    expect(result).toEqual({ text: true, name: false, avatar: false, time: false, right: true, copy: true })
  }, 30_000)

  test('When 渲染助手消息 Then 模型与时间仍保留', async () => {
    const result = await renderer.run(`
      await window.wait(300);
      const message=document.querySelector('#assistant-message');
      return {text:message.textContent.includes('助手消息保持原样'),model:message.textContent.toLowerCase().includes('gpt-6.1'),time:!!message.querySelector('.message-time')};
    `)
    expect(result).toEqual({ text: true, model: true, time: true })
  }, 30_000)

  test('When 长对话滚动并打开导航 Then 左侧居中且预览向右展开，无主滑杆', async () => {
    const result = await renderer.run(`
      await window.wait(300);
      const chat=document.querySelector('#conversation'),nav=document.querySelector('[data-conversation-minimap]');
      if(!nav)return {navigation:false};
      const c=chat.getBoundingClientRect(),n=nav.getBoundingClientRect(),el=window.context.scrollRef.current;
      window.context.stopScroll();el.scrollTop=500;await window.wait();const before=el.scrollTop;
      const trigger=nav.querySelector('[data-minimap-trigger]');trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
      await window.wait(350);
      const panel=nav.querySelector('[data-minimap-preview]'),p=panel?.getBoundingClientRect();
      const target=[...nav.querySelectorAll('button')].find(b=>b.textContent.includes('历史消息 0'));target?.click();await window.wait(700);
      return {navigation:true,left:Math.abs(n.left-c.left-4)<2,center:Math.abs((n.top+n.bottom-c.top-c.bottom)/2)<2,
        hidden:!chat.querySelector('.scroll-progress-track,.scroll-progress-thumb')&&getComputedStyle(el).scrollbarWidth==='none',
        scrolled:before>0,preview:!!panel,rightward:!!p&&p.left>=n.left+24,jumped:el.scrollTop<before};
    `)
    expect(result).toEqual({ navigation: true, left: true, center: true, hidden: true, scrolled: true, preview: true, rightward: true, jumped: true })
  }, 30_000)

  test('When 内容不足一屏 Then 不显示导航触发条且仍无主滑杆', async () => {
    const result = await renderer.run(`
      await window.wait(250);window.setLong(false);await window.wait(250);
      return {trigger:!!document.querySelector('[data-minimap-trigger]'),scrollbar:!!document.querySelector('.scroll-progress-track')};
    `)
    expect(result).toEqual({ trigger: false, scrollbar: false })
  }, 30_000)
})
