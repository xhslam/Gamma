import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

interface ToolbarButtonGeometry {
  label: string
  width: number
  height: number
  centerX: number
  centerY: number
  iconCenterX: number
  iconCenterY: number
  inkWidth: number
  inkHeight: number
}

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai';
    import {Brain} from 'lucide-react';
    import {Button} from '@/components/ui/button';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import {ComposerAttachmentMenu} from '@/components/agent/ComposerAttachmentMenu';
    import {PermissionModeSelector} from '@/components/agent/PermissionModeSelector';
    import {SpeechButton} from '@/components/ai-elements/speech-button';
    import {ThemeFloatingDock,ThemeDockTrigger} from '@/components/ascii-wallpaper/ThemeFloatingDock';
    import {InputToolbarOverflow} from '@/components/ai-elements/InputToolbarOverflow';
    import {inputToolbarButtonClass,inputToolbarActiveButtonClass} from '@/components/ai-elements/input-toolbar-styles';
    import {cn} from '@/lib/utils';
    import '@/styles/globals.css';
    window.electronAPI={
      openFileOrFolderDialog:async()=>({files:[],directories:[]}),
      getVoiceDictationSettings:async()=>({enabled:false}),
      toggleVoiceDictation:async()=>{},
      getSettings:async()=>({}),updateSettings:async()=>({}),
    };
    window.wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await window.wait(20);}throw new Error('工具栏未达到预期');};
    function Fixture(){
      const [open,setOpen]=React.useState(false);
      const items=[
        {key:'wallpaper',node:React.createElement(ThemeDockTrigger)},
        {key:'permission',node:React.createElement(PermissionModeSelector,{sessionId:'probe'})},
        {key:'thinking',node:React.createElement(Button,{type:'button',variant:'ghost',size:'icon','aria-label':'推理设置',className:cn(inputToolbarButtonClass,inputToolbarActiveButtonClass)},React.createElement(Brain,{className:'size-5'}))},
        {key:'speech',node:React.createElement(SpeechButton,{className:inputToolbarButtonClass,voiceInputId:'probe'})},
        {key:'attach',node:React.createElement(ComposerAttachmentMenu,{onAttachContent:async()=>{},onReferenceConversations:()=>{}})},
      ];
      return React.createElement(Provider,{store:createStore()},React.createElement(TooltipProvider,null,
        React.createElement('div',{'data-workbench-density':'comfortable',style:{width:700}},
          React.createElement('div',{'data-input-mode':'agent'},
            React.createElement(ThemeFloatingDock,{open,onOpenChange:setOpen,onSelect:()=>{},onCloseAutoFocus:e=>e.preventDefault()},
              React.createElement(InputToolbarOverflow,{items}))))));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `)
}, 180_000)
afterAll(async () => { await renderer?.dispose() })

const measure = `
  await window.until(()=>document.querySelector('.gamma-composer-footer'));
  await window.wait(250);
  const row=document.querySelector('.gamma-composer-footer > div');
  return [...row.children].flatMap(wrap=>{
    const button=wrap.querySelector('button');
    if(!button)return [];
    const svg=button.querySelector('svg');
    const box=button.getBoundingClientRect();
    const icon=svg.getBoundingClientRect();
    const ink=svg.getBBox();
    const scale=icon.width/24;
    return [{
      label:button.getAttribute('aria-label'),
      width:box.width,height:box.height,
      centerX:box.x+box.width/2,centerY:box.y+box.height/2,
      iconCenterX:icon.x+icon.width/2,iconCenterY:icon.y+icon.height/2,
      inkWidth:ink.width*scale,inkHeight:ink.height*scale,
    }];
  });
`

describe('Given 输入框底部工具栏的五个图标按钮', () => {
  test('When 渲染完成 Then 尺寸一致、间距相等且图标都在按钮正中', async () => {
    const geometry = await renderer.run<ToolbarButtonGeometry[]>(measure)
    expect(geometry.map((item) => item.label)).toEqual([
      '选择场景主题', '完全自动', '推理设置', '开始语音输入', '添加附件或引用对话',
    ])
    for (const item of geometry) {
      expect(item.width).toBe(32)
      expect(item.height).toBe(32)
      // 图标画布必须居中于按钮；调色板此前是原生 button，图标被顶到左上角。
      expect(Math.abs(item.iconCenterX - item.centerX)).toBeLessThan(0.6)
      expect(Math.abs(item.iconCenterY - item.centerY)).toBeLessThan(0.6)
    }
    const gaps = geometry.slice(1).map((item, index) => item.centerX - geometry[index]!.centerX)
    for (const gap of gaps) expect(gap).toBe(38)
    const rows = new Set(geometry.map((item) => item.centerY))
    expect(rows.size).toBe(1)
  }, 60_000)

  test('When 比较字形墨迹高度 Then 加号与其他图标等高，不再明显偏小', async () => {
    const geometry = await renderer.run<ToolbarButtonGeometry[]>(measure)
    const plus = geometry.find((item) => item.label === '添加附件或引用对话')!
    const others = geometry.filter((item) => item.label !== '添加附件或引用对话')
    for (const item of others) {
      expect(Math.abs(plus.inkHeight - item.inkHeight)).toBeLessThan(0.6)
    }
  }, 60_000)
})
