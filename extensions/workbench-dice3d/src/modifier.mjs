export const MODIFIER_LIMIT=999999;
export const validModifier=value=>value===undefined||(Number.isInteger(value)&&Math.abs(value)<=MODIFIER_LIMIT);
