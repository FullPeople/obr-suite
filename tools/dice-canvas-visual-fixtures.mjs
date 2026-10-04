// Deterministic physical outcomes consumed by the actual production formula evaluator.
export const formulas=[
 {id:'plain-20d6',formula:'20d6',values:Array.from({length:20},(_,i)=>i%6+1)},
 {id:'maximum-impact',formula:'1d20',values:[20],card:true},
 {id:'advantage-discard',formula:'adv(2d6+1)',values:[2,6,4,6],card:true},
 {id:'disadvantage-natural-one',formula:'dis(1d20)',values:[20,1],card:true},
 {id:'reroll',formula:'resetmin(3d6,2)',values:[1,2,6,4,5],card:true},
 {id:'sequential-clamps',formula:'max(min(3d6,4),3)',values:[1,3,6],card:true},
 {id:'same-value',formula:'same(4d6)',values:[2,2,5,5],card:true},
 {id:'burst',formula:'burst(2d6)',values:[6,3,4],card:true},
 {id:'arithmetic',formula:'(2d6+3)*2',values:[1,6]},
 {id:'repeat-overlap',formula:'repeat(2,adv(1d20))',values:[1,20,15,4],card:true},
];
