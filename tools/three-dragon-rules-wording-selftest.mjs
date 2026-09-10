// Full prose contracts, checked against LE pp. 6–11/16–24 and the actual engine.
// These are wording regressions, not additional rules-engine coverage.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),base=resolve(root,'extensions/three-dragon-ante/src/game/rules');
const out=mkdtempSync(join(tmpdir(),'tda-rules-wording-'));
const entry=join(out,'entry.ts');
writeFileSync(entry,`export * from ${JSON.stringify(join(base,'prompts.ts').replaceAll('\\','/'))};\nexport {CARDS} from ${JSON.stringify(join(base,'cards.ts').replaceAll('\\','/'))};\n`);
const file=join(out,'words.mjs');await build({input:entry,platform:'node',output:{file,format:'esm'}});
const {CARD_HINTS,RULE_PROMPTS,CARDS,cardHint,rulePrompt}=await import(pathToFileURL(file).href);
const checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const families=[...new Set(CARDS.map(c=>c.family))];
check('all 100 base-box cards resolve to exactly 40 explained families',CARDS.length===100&&families.length===40);
assert.deepEqual(Object.keys(CARD_HINTS).sort(),families.sort());
for(const c of CARDS)for(const language of ['zh','en'])check(`${c.id}/${language}: localized full explanation resolves`,cardHint(c.family,language)===CARD_HINTS[c.family][language==='zh'?0:1]&&cardHint(c.family,language)!==c.family);
for(const family of families){
 const [zh,en]=CARD_HINTS[family];
 check(`${family}: Chinese complete sentences and no shorthand`,zh.endsWith('。')&&zh.split('。').filter(Boolean).length>=2&&!/抽\s*\d+(?!\d|\s*张)|抓\s*\d+(?!\d|\s*张)|付\s*\d+(?!\d|\s*金币)|航线/.test(zh));
 check(`${family}: English sentences and no omitted power reference`,en.endsWith('.')&&en.split(/\.[ \n]+/).length>=2&&!/same as|double the blue|silver draw|…|\.\.\./i.test(en));
 check(`${family}: explicit activation or always-active timing`,zh.includes('发动')||zh.includes('一直生效'));
}
// Each pair locks a substantive, easily lost condition in both languages.
// These checks intentionally do not snapshot full prose or enforce a word-for-word translation.
const conditions={
 black:['中央奖池取走 3 金币','3 gold from the central stakes'],
 blue:['每位对手就向中央奖池支付 1 金币','1 gold for every card in your flight'],
 brass:['你右边的对手作出选择','opponent on your right chooses'],
 bronze:['已有 9 张手牌','With 9 cards already in hand'],
 copper:['先完整结算替换及能力，再检查组合奖励','Finish replacements and powers before checking flight rewards'],
 gold:['从牌堆里抽 1 张牌加入自己的手牌','draw 1 card from the deck into your hand'],
 green:['你左边的对手作出选择','opponent on your left chooses'],
 red:['不计你自己的牌阵','excluding your own'],
 silver:['从你开始，再按顺时针方向','your draw first, then proceed clockwise'],
 white:['总强度最低的对手向你支付 2 金币','lowest total pays you 2 gold'],
 bahamut:['限制一直生效，无须触发','restriction applies without triggering'],
 'black-raider':['后续收款不再执行','no later payments occur'],
 'blue-overlord':['每位对手就向中央奖池支付 2 金币','2 gold for every card in your flight'],
 'brass-sultan':['同一个对手要分别处理左邻和右邻这两次要求','same opponent resolves this demand twice'],
 'bronze-warlord':['第三轮结束时如果你没有赢得本轮局','if you do not win this gambit at the end of round three'],
 'chromatic-wyrmling':['从自己的手牌中选 1 张邪龙','1 evil dragon from your own hand'],
 'copper-trickster':['新牌必须发动能力，不能跳过','new power must trigger and cannot be skipped'],
 dracolich:['等到本轮局结算时','when this gambit is scored'],
 'gold-monarch':['在取得奖池后必须从自己的金币中向每位对手各支付 3 金币','pay each opponent 3 gold from your own hoard after receiving the stakes'],
 'green-schemer':['点数低于发动能力的牌的邪龙','evil dragon from their hand with strength below'],
 'metallic-wyrmling':['从自己的手牌中选 1 张善龙','1 good dragon from your own hand'],
 'red-destroyer':['总强度最高的对手向你支付 10 金币','highest total pays you 10 gold'],
 'silver-seer':['本牌桌让你选 1 张放回牌堆顶','this table has you return 1 card to the deck'],
 tiamat:['没有需要触发的普通能力','no normal power to trigger'],
 'white-hunter':['每位严格低于你的对手','Each opponent whose total is strictly lower than yours'],
 archmage:['已经给予你的这个效果也不会取消','effect already granted to you continues until this gambit ends'],
 dragonrider:['结算时没有龙牌，它就算 0 点','With no dragons at scoring, it is worth 0'],
 dragonslayer:['自己的龙牌也包括在内','Your own dragons are eligible too'],
 druid:['总强度最低的玩家获胜','lowest flight total wins this gambit'],
 fool:['每有 1 位对手严格高于你','For each opponent strictly above your total'],
 illusionist:['对手牌阵中的 1 张凡人牌','1 mortal in an opponent'],
 kobold:['先一次选好并确认','Select and confirm all the cards to discard first'],
 'merchant-prince':['之后由那位玩家收取买牌款','that player receives subsequent purchase payments'],
 priest:['胜者多拿 1 金币','winner receives the extra 1 gold'],
 princess:['不会再被公主重复发动一次','Princess does not trigger that replacement an additional time'],
 prophet:['按预言家的 10 点','use the Prophet\'s 10'],
 queen:['每位对手自己的牌阵','each opponent\'s own flight'],
 sorcerer:['等新牌及后续能力完整结算后，再把另外 2 张','Only after that power and any resulting powers finish'],
 thief:['中央奖池取走 7 金币','7 gold from the central stakes'],
 wyrmpriest:['仍然是一张凡人牌','remains a mortal'],
};
assert.deepEqual(Object.keys(conditions).sort(),families);
for(const [family,clauses]of Object.entries(conditions))for(let i=0;i<2;i++)check(`${family}/${i===0?'zh':'en'}: preserves reviewed condition`,CARD_HINTS[family][i].includes(clauses[i]));
for(const family of ['gold','gold-monarch','silver','silver-seer','fool','kobold'])for(let i=0;i<2;i++)check(`${family}/${i}: explicitly draws cards from the deck`,i===0?/从牌堆里抽/.test(CARD_HINTS[family][i]):/draw\w* (?:1 card|the same number of cards) from the deck/i.test(CARD_HINTS[family][i]));
for(const family of ['gold','gold-monarch','silver','silver-seer'])for(let i=0;i<2;i++)check(`${family}/${i}: copied powers never count the dragon still in Prophet's hand`,CARD_HINTS[family][i].includes(i===0?'只数牌阵中的善龙，不数手牌':'Do not count dragons in your hand'));
for(const family of ['bronze','brass','green','gold','silver','red','red-destroyer','queen','fool','silver-seer','brass-sultan','green-schemer','gold-monarch','bronze-warlord'])for(let i=0;i<2;i++)check(`${family}/${i}: describes ten-card limit`,CARD_HINTS[family][i].includes('10'));
for(const family of ['red','red-destroyer','queen'])for(let i=0;i<2;i++)check(`${family}/${i}: random transfer comes from a hand and stays private`,i===0?CARD_HINTS[family][i].includes('手牌中随机拿走 1 张')&&CARD_HINTS[family][i].includes('其他玩家不看'):CARD_HINTS[family][i].includes('1 random card from that opponent\'s hand')&&/without (revealing|showing)/.test(CARD_HINTS[family][i]));
const choices={
 BLUE_DESTINATION:['所有对手','every opponent'],
 GIVE_DRAGON_OR_GOLD:['发动此能力的玩家','player using this power'],
 LOWEST_ANTE_CARD:['剩余最低点数','lowest-strength cards remaining'],
 KEEP_ONE_ANTE_CARD:['另一张留在公开下注区','leave the other in the public ante area'],
 REPLACE_OTHER_FLIGHT_CARD:['自己','your own flight'],
 REPLACE_WYRMLING:['保留原牌','keep the original card'],
 TRIGGER_REPLACEMENT:['即使不发动','If you decline'],
 WEAKEST_OPPONENT:['不把你自己算在内','excluding yourself'],
 STRONGEST_OPPONENT:['手牌中随机拿走 1 张','1 random card from that opponent\'s hand'],
 REMOVE_WEAKER_DRAGON:['就必须选一张','must choose one'],
 EXCHANGE_HAND_CARDS:['一张都不选','including none'],
 SWAP_MORTAL:['对手牌阵中的一张凡人牌','a mortal in an opponent\'s flight'],
 NEXT_GOOD_DRAGON_POWER:['若它仍在自己的牌阵中','if it is still in your flight'],
 COPY_HAND_DRAGON:['仍留在手中','stays in your hand'],
 KEEP_SEER_CARD:['保留牌的身份不向其他玩家公开','Other players do not see the card you keep'],
 SEER_HAND_FULL_KEEP_TOP:['本牌桌的处理方式','This table handles the limit'],
 SORCERER_REPLACEMENT:['先完整结算新牌能力，再把其余','Resolve the new card\'s power first, then'],
 STRENGTH_FLIGHT_ANTE:['手牌达到 10 张时停止','your hand reaches 10 cards'],
};
// BLUE wording uses 每位; the scope is all opponents, not a target selector.
choices.BLUE_DESTINATION[0]='每位对手';
for(const [code,clauses]of Object.entries(choices))for(let i=0;i<2;i++)check(`${code}/${i}: explains the real choice and its boundary`,rulePrompt(code,i===0?'zh':'en')===RULE_PROMPTS[code][i]&&RULE_PROMPTS[code][i].includes(clauses[i]));
check('payment option names recipient rather than implying stakes',rulePrompt('PAY_FIVE','zh').includes('发动此能力的玩家')&&rulePrompt('PAY_FIVE','en').includes('player using this power'));
check('skip distinguishes keeping a replacement from cancelling it',rulePrompt('SKIP_POWER','zh').includes('仍保留这张牌')&&rulePrompt('SKIP_POWER','en').includes('Keep the new card'));
const sourcePins=Object.fromEntries(['prompts.ts','cards.ts'].map(name=>[name,createHash('sha256').update(readFileSync(join(base,name))).digest('hex')]));
const result={scope:'Wording contracts only; 40 families manually compared against engine and publisher LE pp. 6–11/16–24. No room, GPU or rules-action coverage claimed.',publisher:'https://wizkids.com/posters/repository/wizkids/3%20Dragon%20Ante%20Rulebook%20WEB.pdf',passed:checks.length,cardCount:CARDS.length,families:families.length,choices:Object.keys(choices).length,sourcePins,checks};
writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,out,sourcePins}));
