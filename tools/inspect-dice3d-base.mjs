import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
const entries=execFileSync('git',['ls-tree','-r','HEAD'],{encoding:'utf8'}).trim().split('\n').map(line=>{const [info,name]=line.split('\t');return[name,info.split(' ')[2]];});writeFileSync('.cache/dice3d-base-tree.json',JSON.stringify(Object.fromEntries(entries)));
