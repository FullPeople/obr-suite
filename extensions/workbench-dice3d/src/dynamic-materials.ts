/** Original procedural patterns, all in object-space metres × visual scale. No face UV tiling.
 * Time is the published roll age, shared with the outline; it never changes body transforms.
 * References/intent and provisional visual acceptance live in DYNAMIC_MATERIALS.md. */
export const DYNAMIC_HELPERS=/* glsl */`
  float ddValue(vec3 p){
    vec3 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(diceNoise(cell),diceNoise(cell+vec3(1,0,0)),f.x),
      mix(diceNoise(cell+vec3(0,1,0)),diceNoise(cell+vec3(1,1,0)),f.x),f.y),
      mix(mix(diceNoise(cell+vec3(0,0,1)),diceNoise(cell+vec3(1,0,1)),f.x),
      mix(diceNoise(cell+vec3(0,1,1)),diceNoise(cell+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float ddFbm(vec3 p){return ddValue(p)*.57+ddValue(p*2.03+7.1)*.29+ddValue(p*4.11-3.7)*.14;}
  float ddLine(float d,float width){float aa=max(fwidth(d),.001);return 1.-smoothstep(width-aa,width+aa,abs(d));}
  vec2 ddPrintUV(vec3 p){return vec2(dot(p,vec3(.81,.26,.53)),dot(p,vec3(-.32,.94,.21)));}
  float ddDots(vec2 p,float radius){vec2 cell=fract(p)-.5;float d=length(cell),aa=max(fwidth(d),.012);return 1.-smoothstep(radius-aa,radius+aa,d);}
  float ddSegment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));}
  float ddRune(vec3 p){
    // A body-space projection, NOT a restarted tile on each face. Angular seals and broken
    // connecting rails remain continuous across edges; no actual language or borrowed glyphs.
    vec2 uv=ddPrintUV(p)*3.6,cell=floor(uv),q=fract(uv)-.5;
    float variant=diceNoise(vec3(cell,3.1));q.x*=variant>.5?-1.:1.;
    float d=ddSegment(q,vec2(-.10,-.29),vec2(-.10,.29));
    d=min(d,ddSegment(q,vec2(-.10,.25),vec2(.17,.06)));
    d=min(d,ddSegment(q,vec2(.17,.06),vec2(-.10,-.09)));
    if(variant>.32)d=min(d,ddSegment(q,vec2(-.10,.03),vec2(.17,-.22)));
    if(variant>.70)d=min(d,ddSegment(q,vec2(-.27,-.13),vec2(.18,-.13)));
    float rune=ddLine(d,.016);
    float rail=ddLine(q.y-.40,.006)*(1.-smoothstep(.28,.39,abs(q.x)));
    return max(rune,rail*.28);
  }
`;
export const DYNAMIC_BODY=/* glsl */`
  else if(diceStyle<5.5){
    float tick=floor(diceTime*12.);
    vec2 plate=ddPrintUV(dp)+vec2(sin(tick*1.9),cos(tick*2.3))*.004;
    float dots=ddDots(plate*19.,.19+.07*sin(dot(dp,vec3(4,3,5))));
    float hatch=ddLine(sin(dot(dp,vec3(13,23,9))),.09);
    vec3 paper=max(diffuseColor.rgb,vec3(.022));
    float fleck=diceNoise(floor(dp*240.));
    float misprint=ddDots((plate+vec2(.008,-.004))*19.,.23)*(1.-dots);
    diffuseColor.rgb=paper*(.96+.04*fleck);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.003,.005,.009),dots*.55+hatch*.13);
    diffuseColor.rgb+=misprint*(paper*.24+vec3(.013));
  }else if(diceStyle<6.5){
    float t=diceTime*.18;
    vec3 flow=dp*2.9+vec3(sin(t*.8),t*.37,cos(t*.7))*.38;
    float a=ddFbm(flow),b=ddFbm(flow+vec3(3.7,8.2,-2.4));
    float wash=ddFbm(flow+vec3(a,b,a-b)*2.3);
    float strata=sin(wash*33.+a*2.+t*.45);
    float feather=ddLine(strata,.11)*.27;
    float pool=smoothstep(.40,.69,wash);
    vec3 pigment=max(diffuseColor.rgb,vec3(.022));
    vec3 paper=mix(pigment,vec3(.68,.66,.61),.22);
    vec3 deep=pigment*.12+vec3(.003,.004,.007);
    diffuseColor.rgb=mix(paper,deep,pool*.84);
    diffuseColor.rgb=mix(diffuseColor.rgb,deep,feather);
    diffuseColor.rgb*=.96+.04*grain;
  }else{
    vec3 hue=diffuseColor.rgb;
    diffuseColor.rgb=hue*.085+vec3(.008,.011,.017);
    float glyphLines=ddRune(dp);
    float phase=dot(dp,vec3(.65,.88,-.47))-diceTime*.34;
    float pulse=pow(.5+.5*sin(phase*8.),8.);
    dynamicGlow=glyphLines*(.18+.82*pulse);
    dynamicTint=mix(hue,vec3(.46,.54,.62),.32);
    // Fine veins are deliberately dim; moving segments, not a full-face white glare.
    diffuseColor.rgb+=dynamicTint*glyphLines*.10;
  }
`;
export const DYNAMIC_LIGHT=/* glsl */`
  if(diceStyle>4.5&&diceStyle<5.5){
    float shade=dot(normal,normalize(vec3(-.35,.8,.5)));
    float bands=shade>.48?1.25:shade>-.15?.82:.38;
    outgoingLight=diffuseColor.rgb*bands+vec3(.009);
  }
  if(diceStyle>5.5&&diceStyle<6.5){
    float shade=dot(normal,normalize(vec3(-.35,.8,.5)));
    outgoingLight=diffuseColor.rgb*(.63+.43*smoothstep(-.4,.7,shade))+vec3(.005);
  }
  if(diceStyle>6.5){
    float facing=pow(1.-abs(dot(normal,normalize(vViewPosition))),3.);
    outgoingLight=diffuseColor.rgb*(.80+facing*.45);
    outgoingLight+=dynamicTint*dynamicGlow*.95*(1.-halo);
  }
`;
export const DYNAMIC_INK=/* glsl */`
  else if(diceStyle>5.5){
    // Quiet pale/dark ink on moving wash, a restrained dark keyline on luminous runes.
    // This protected pass prevents either animated material from painting over the value.
    vec3 key=diceStyle>6.5?diceOutline:mix(diceOutline,gl_FragColor.rgb,.40);
    gl_FragColor.rgb=mix(gl_FragColor.rgb,key,halo*.82);
    vec3 marked=mix(diceGlyph,mix(diceGlyph,vec3(1.),.18),wipe);
    gl_FragColor.rgb=mix(gl_FragColor.rgb,marked,ink);
    gl_FragColor.a=1.;
  }
`;
