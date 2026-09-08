export const pondVertexShader = `
  uniform mat4 textureMatrix;
  uniform float waterTime;
  varying vec4 vUv;
  varying vec3 worldPoint;
  void main(){
    vec3 p=position;
    // Small physical swells; fine ripples are resolved per fragment.
    p.z += sin(p.x*.52+waterTime*.7)*cos(p.y*.37-waterTime*.5)*.018;
    vUv=textureMatrix*vec4(p,1.);
    worldPoint=(modelMatrix*vec4(p,1.)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
  }
`;
export const pondFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float waterTime;
  uniform vec3 pulse;
  uniform vec4 pondFish[8];
  varying vec4 vUv;
  varying vec3 worldPoint;
  float swell(vec2 p){
    float t=waterTime;
    float h=sin(dot(p,vec2(.9,.6))+t*.65)*.035;
    h+=sin(dot(p,vec2(-1.7,1.1))-t*.9)*.016;
    h+=sin(dot(p,vec2(3.1,2.3))+t*1.3)*.008;
    h+=sin(dot(p,vec2(-5.8,3.7))-t*1.5)*.004;
    h+=sin(dot(p,vec2(11.4,7.3))+t*1.9)*.002;
    float d=distance(p,pulse.xy),age=max(0.,t-pulse.z);
    h+=sin(d*9.-age*13.)*exp(-pow(d-age*2.6,2.)*.65)*exp(-age*.22)*.06;
    for(int i=0;i<8;i++){
      vec2 delta=p-pondFish[i].xy;
      float fd=length(delta);
      float wake=sin(fd*7.-t*4.+float(i)*1.7)*exp(-fd*.72);
      h+=wake*.022;
    }
    return h;
  }
  vec4 koi(vec2 p,vec4 fish,float id){
    vec2 d=p-fish.xy;
    float c=cos(fish.z),s=sin(fish.z);
    vec2 q=vec2(c*d.x+s*d.y,-s*d.x+c*d.y);
    q.y+=sin(q.x*4.-fish.w)*.055*(1.-smoothstep(-1.,.5,q.x));
    float body=length(vec2((q.x-.05)/.88,q.y/.26));
    float tail=length(vec2((q.x+1.02)/.38,q.y/(.13+.17*max(0.,-q.x-.75))));
    float fins=length(vec2((q.x+.1)/.32,(abs(q.y)-.26)/.18));
    float alpha=max(1.-smoothstep(.88,1.09,body),max((1.-smoothstep(.75,1.,tail))*.7,(1.-smoothstep(.7,1.,fins))*.38));
    float patches=sin(q.x*9.+id*5.)+cos(q.y*16.+q.x*6.);
    vec3 ivory=vec3(.62,.55,.35),red=vec3(.56,.085,.024);
    vec3 col=mix(ivory,red,smoothstep(.05,.6,patches));
    if(mod(id,3.)>1.5)col=mix(vec3(.3,.17,.025),vec3(.68,.4,.08),smoothstep(-.2,1.,patches));
    col*=.55+.45*sqrt(max(0.,1.-min(1.,body*body)));
    float eyes=1.-smoothstep(.025,.052,length(vec2(q.x-.6,abs(q.y)-.12)));
    col=mix(col,vec3(.008,.016,.019),eyes);
    return vec4(col,alpha*.72);
  }
  void main(){
    vec2 p=worldPoint.xz;
    float e=.035;
    vec2 slope=vec2(swell(p+vec2(e,0.))-swell(p-vec2(e,0.)),swell(p+vec2(0.,e))-swell(p-vec2(0.,e)))/(2.*e);
    vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
    vec3 eye=normalize(cameraPosition-worldPoint);
    float fresnel=.07+.83*pow(1.-max(dot(eye,n),0.),4.);
    vec2 uv=vUv.xy/vUv.w;
    uv+=slope*.055;
    float blur=.0007+length(slope)*.003;
    vec3 reflection=texture2D(tDiffuse,uv).rgb*.4;
    reflection+=texture2D(tDiffuse,uv+vec2(blur,blur*.4)).rgb*.15;
    reflection+=texture2D(tDiffuse,uv-vec2(blur,blur*.4)).rgb*.15;
    reflection+=texture2D(tDiffuse,uv+vec2(-blur*.5,blur)).rgb*.15;
    reflection+=texture2D(tDiffuse,uv-vec2(-blur*.5,blur)).rgb*.15;
    vec3 deep=vec3(.008,.032,.04);
    vec3 sky=vec3(.055,.11,.15);
    vec3 water=mix(deep,sky,fresnel*.48);
    // Subsurface fish are refracted by the same wave normals and covered by reflections.
    for(int i=0;i<8;i++){
      vec4 fish=koi(p+slope*.22,pondFish[i],float(i));
      water=mix(water,fish.rgb,fish.a*(1.-fresnel*.72));
    }
    // Lamps retain a warm, broken reflection even at steep viewing angles.
    float lamp=max(0.,reflection.r-reflection.b)*1.8;
    water=mix(water,reflection,clamp(.30+fresnel*.48+lamp*.28,0.,.92));
    vec3 sun=normalize(vec3(.38,.06,-1.));
    float spec=pow(max(dot(n,normalize(sun+eye)),0.),180.);
    water+=vec3(.65,.72,.63)*spec*.32;
    float distanceFog=1.-exp(-length(worldPoint-cameraPosition)*.009);
    water=mix(water,vec3(.035,.08,.105),distanceFog*.35);
    gl_FragColor=vec4(water,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
