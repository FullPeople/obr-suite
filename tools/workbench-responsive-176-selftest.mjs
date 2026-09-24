import {join} from 'node:path';

/** Run against the linked GM fixture with Wiki, inventory, settings and two roster cards enabled. */
export async function auditResponsive176({page,bg,check,expect,out}){
 const before=page.viewportSize();
 try{
  await page.getByRole('button',{name:'总览',exact:true}).click();
  for(const [width,count] of [[900,3],[600,2],[254,1]]){
   await page.setViewportSize({width,height:920});
   await expect(page.locator('.dm-console')).toBeVisible();
   await expect.poll(()=>page.locator('.console-roster').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(count);
   check(true,`live overview uses ${count} columns at ${width}px`);
  }
  const warehouse=page.locator('.public-stock');
  if(await warehouse.getByRole('button',{name:'展开公共仓库',exact:true}).count())await warehouse.getByRole('button',{name:'展开公共仓库',exact:true}).click();
  await warehouse.locator('h3').click();await expect(warehouse.getByRole('button',{name:'展开公共仓库',exact:true})).toBeVisible();await expect(warehouse.locator('[data-stock-slot]')).toHaveCount(0);
  await warehouse.locator('header').press('Enter');await expect(warehouse.locator('[data-stock-slot]').first()).toBeVisible();check(true,'clicking warehouse title and Enter both toggle the entire section');
  await page.getByRole('button',{name:'功能开关',exact:true}).click();
  const features=page.frameLocator('iframe[title="Full Suite 功能开关"]');await features.locator('body[data-bridge-ready=true]').waitFor();
  for(const [width,count] of [[900,3],[600,2],[254,1]]){
   await page.setViewportSize({width,height:920});
   await expect.poll(()=>features.locator('.feature-toggle-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBeGreaterThanOrEqual(count);
   if(width===254)await expect.poll(()=>features.locator('.feature-toggle-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
   check(true,`embedded feature switches wrap without horizontal overflow at ${width}px`);
   const overflow=await features.locator('.feature-toggle-grid').evaluate(el=>el.scrollWidth-el.clientWidth);check(overflow<=1,'feature grid stays inside its pane');
  }
  await page.getByRole('button',{name:'总览',exact:true}).click();await page.locator('.mobile-tabs').getByRole('button',{name:'Wiki',exact:true}).click();
  await page.getByRole('navigation',{name:'资料分类'}).getByRole('button',{name:'装备',exact:true}).click();
  const entry=page.locator('.catalog-row').filter({hasText:'铜制罗盘'}).first();await expect(entry).toBeVisible();const bounds=await entry.boundingBox();
  await page.mouse.move(bounds.x+12,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+24,bounds.y+bounds.height/2,{steps:3});
  await expect(page.locator('.dm-console')).toBeVisible();await expect(page.locator('.app-shell')).toHaveAttribute('data-workbench-page','console');await expect(page.locator('.sheet-pane')).toHaveClass(/mobile-active/);
  await expect(page.locator('.public-stock .drop-ready')).toBeVisible();check(true,'narrow Wiki drag reveals the existing overview and highlights its warehouse');
  const heading=await page.locator('.overview-heading').boundingBox();await page.mouse.move(heading.x+heading.width/2,heading.y+heading.height/2,{steps:4});await page.mouse.up();await expect(page.locator('.pointer-ghost')).toHaveCount(0);await expect(page.locator('.wiki-pane')).toHaveClass(/mobile-active/);await expect(page.locator('.dm-console')).not.toBeVisible();check(true,'releasing an overview drag returns to the previous Wiki pane');
  await page.locator('.mobile-tabs').getByRole('button',{name:'功能页',exact:true}).click();await page.screenshot({path:join(out,'overview-narrow-176.png')});
  await bg.evaluate(()=>window.wbMock.select(['one']));await expect(page.locator('.overview-sheet')).toBeVisible();
  await bg.evaluate(()=>window.wbMock.select(['goblin']));await expect(page.locator('.paper .workbench-monster')).toBeVisible();
  const monster=await page.locator('.paper').boundingBox(),viewport=await page.locator('.sheet-viewport').boundingBox();check(monster.width>235&&monster.y-viewport.y<=34,'linked monster occupies narrow width and starts below its top tabs');await expect(page.getByRole('tablist',{name:'角色卡页面'})).toHaveAttribute('aria-orientation','horizontal');await page.screenshot({path:join(out,'monster-narrow-176.png')});
  await page.getByRole('button',{name:'卡片全屏',exact:true}).click();await expect(page.locator('.sheet-pane')).toHaveClass(/sheet-fullscreen/);check((await page.locator('.sheet-pane').boundingBox()).height===920,'monster fullscreen fills the current browser viewport');await page.keyboard.press('Escape');await expect(page.locator('.sheet-pane')).not.toHaveClass(/sheet-fullscreen/);
  await page.getByRole('tab',{name:/阿明/}).click();await expect(page.locator('.overview-sheet')).toBeVisible();const character=await page.locator('.paper').boundingBox();check(Math.abs(character.width-monster.width)<1,'linked character and monster retain the same readable narrow pane width');await page.screenshot({path:join(out,'character-narrow-176.png')});
 }finally{
  await page.mouse.up();if(before)await page.setViewportSize(before);await page.getByRole('button',{name:'总览',exact:true}).click();
 }
}
