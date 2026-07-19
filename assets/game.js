/* ============================================================
   MARINA BAY · 新加坡滨海湾夜赛 3D F1
   Three.js r160 · 自包含 · 无外部模型
   街道赛 · 夜赛 · TECPRO围栏 · 观众席 · 城市建筑
   ============================================================ */
/* THREE 由 HTML 中的 <script> 标签加载为全局变量 */
/* eslint-disable no-unused-vars */

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const canvas = $('game');
const ui = {
  lapBig:$('lapBig'), lapTotal:$('lapTotal'), posBig:$('posBig'), posTotal:$('posTotal'),
  flag:$('flag'), raceInfo:$('raceInfo'),
  speedo:$('speedo'), gear:$('gear'), rpmBar:$('rpmBar'),
  tireFill:$('tireFill'), tireVal:$('tireVal'),
  ersFill:$('ersFill'), ersVal:$('ersVal'),
  fuelFill:$('fuelFill'), fuelVal:$('fuelVal'),
  drsBox:$('drsBox'),
  s1:$('s1'), s2:$('s2'), s3:$('s3'),
  msg:$('msg'), msg1:$('msg1'), msg2:$('msg2'), lights:$('lights'),
  startScreen:$('startScreen'), overScreen:$('overScreen'), pauseScreen:$('pauseScreen'),
  garageScreen:$('garageScreen'),
  finalScore:$('finalScore'), bestLap:$('bestLap'), topSpeed:$('topSpeed'), pitCount:$('pitCount'), overSub:$('overSub'),
  minimap:$('minimap'), camMode:$('camMode'), driverInfo:$('driverInfo'),
  steerDot:$('steerDot'), gDot:$('gDot'), gVal:$('gVal'),
  rpmFill:$('rpmFill'), rpmVal:$('rpmVal'),
  lapTimer:$('lapTimer'), deltaTime:$('deltaTime'),
  tireRow:$('tireRow'), fuelRow:$('fuelRow'),
  posNotify:$('posNotify'), gapAheadVal:$('gapAheadVal'), gapBehindVal:$('gapBehindVal'),
  speedBlur:$('speedBlur'),
};

// ---------- WebGL 检测 ----------
function webglOK(){
  try{ const t=document.createElement('canvas'); return !!(window.WebGLRenderingContext && (t.getContext('webgl')||t.getContext('experimental-webgl'))); }
  catch(e){ return false; }
}
function showNoWebGL(){
  ui.startScreen.innerHTML='<div style="text-align:center;padding:2rem"><h2 style="color:#fff;font-size:1.6rem;margin-bottom:1rem">需要 WebGL 支持</h2><p style="color:#bcd;font-size:1rem;line-height:1.6">你的浏览器未启用 WebGL，无法运行 3D 赛车。<br>请使用最新版 Chrome / Edge / Firefox，或在浏览器设置中开启硬件加速后刷新本页。</p></div>';
  document.getElementById('game').style.display='none';
}
let renderer;
if(!webglOK()){ showNoWebGL(); throw new Error('WebGL unavailable'); }
try{ renderer = new THREE.WebGLRenderer({ canvas, antialias:true }); }
catch(e){ showNoWebGL(); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

// ---------- 夜赛场景 (明亮) ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x253050);
scene.fog = new THREE.FogExp2(0x253050, 0.00025);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.3, 4000);
camera.position.set(0, 60, 60);

// 夜赛灯光：平衡亮度与性能
const ambient = new THREE.AmbientLight(0x7788bb, 0.6);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x8aacee, 0x303850, 0.9);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xc8d8ff, 0.7);
moon.position.set(-200, 500, 300);
moon.castShadow = true;
moon.shadow.mapSize.set(1024,1024);
moon.shadow.camera.near = 50; moon.shadow.camera.far = 1500;
const mc = moon.shadow.camera; mc.left=-500; mc.right=500; mc.top=500; mc.bottom=-500;
scene.add(moon);

// ---------- 地面 ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(8000,8000),
  new THREE.MeshStandardMaterial({ color:0x1a1e2e, roughness:0.85, metalness:0.1 })
);
ground.rotation.x = -Math.PI/2; ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);

// ============================================================
//  赛道加载 — 数据定义在 assets/tracks.js (TRACKS)
//  当前选中赛道由 TRACK.id 决定, 默认第一条可用赛道
// ============================================================
const TRACK = TRACKS.find(t=>t.available) || TRACKS[0];
const WP = TRACK.wp;
const CORNER_NAMES = TRACK.cornerNames;
const ROAD_W = 16, HALF_W = ROAD_W/2;
const WALL_OFFSET = 0.8;  // 围栏距赛道边 (视觉与碰撞统一)
const WALL_DIST = HALF_W + WALL_OFFSET; // =8.8, 视觉与碰撞共用
const N_WP = WP.length;
const S1_END = TRACK.sectorEnds[0]/N_WP, S2_END = TRACK.sectorEnds[1]/N_WP;
const DRS_ZONES = TRACK.drsZones.map(z=>[z[0]/N_WP, z[1]/N_WP]);
const PIT_ZONE = TRACK.pitZone.map(z=>[z[0]/N_WP, z[1]===null?1.0:z[1]/N_WP]);

// 构建闭合曲线
const waypoints = WP.map(p=>new THREE.Vector3(p[0],0,p[1]));
const curve = new THREE.CatmullRomCurve3(waypoints, true, 'centripetal', 0.5);

// 稠密采样点
const NSAMP = 600;
const SAMPLES = [];
const TANGENTS = [];
const SIDENORMALS = [];
const RACING_LINE_OFFSET = []; // 每个采样点的理想走线横向偏移 (-1=左, 1=右)
const sp = curve.getSpacedPoints(NSAMP-1);
for(let i=0;i<NSAMP;i++){
  SAMPLES.push(sp[i].clone());
  const t = curve.getTangentAt(i/NSAMP).normalize();
  TANGENTS.push(t);
  SIDENORMALS.push(new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), t).normalize());
}
// 预计算赛道曲率和理想走线偏移
for(let i=0;i<NSAMP;i++){
  // 通过相邻切线的角度差计算曲率
  const look = 4; // 前后各看4个点
  const t1 = TANGENTS[((i-look)%NSAMP+NSAMP)%NSAMP];
  const t2 = TANGENTS[(i+look)%NSAMP];
  const crossY = t1.x*t2.z - t1.z*t2.x; // 叉积Y分量 = sin(theta)
  const dot = t1.x*t2.x + t1.z*t2.z;    // 点积 = cos(theta)
  // crossY > 0: 左转, crossY < 0: 右转
  // 曲率越大, 走线越靠内侧
  const curvature = Math.atan2(Math.abs(crossY), dot); // 0~PI
  // 理想走线: 弯道内侧偏移, 直道中线
  const cornerIntensity = THREE.MathUtils.clamp(curvature*2.5, 0, 1); // 0=直道, 1=急弯
  const innerSide = Math.sign(crossY); // +1=左转内侧(右), -1=右转内侧(左)
  // 走线偏移: 直道=0, 弯道内侧偏移, 偏移量受cornerIntensity控制
  RACING_LINE_OFFSET.push(innerSide * cornerIntensity * 0.65);
}
// 平滑走线 (3次移动平均)
for(let pass=0;pass<3;pass++){
  const smooth=[];
  for(let i=0;i<NSAMP;i++){
    const p=(RACING_LINE_OFFSET[((i-1)%NSAMP+NSAMP)%NSAMP]+RACING_LINE_OFFSET[i]+RACING_LINE_OFFSET[(i+1)%NSAMP])/3;
    smooth.push(p);
  }
  for(let i=0;i<NSAMP;i++) RACING_LINE_OFFSET[i]=smooth[i];
}
function sideNormalAt(i){ return SIDENORMALS[i]; }
function racingLinePoint(i){
  const p=SAMPLES[i].clone();
  const n=SIDENORMALS[i];
  const offset=RACING_LINE_OFFSET[i]*HALF_W*0.75;
  p.addScaledVector(n, offset);
  return p;
}
// 预计算曲率数组 (用于AI弯道减速, 向心加速度公式 v²=a/κ)
const CURVATURE=[];
for(let i=0;i<NSAMP;i++){
  const ta=TANGENTS[(i-3+NSAMP)%NSAMP], tb=TANGENTS[(i+3)%NSAMP];
  const dot=THREE.MathUtils.clamp(ta.x*tb.x+ta.z*tb.z, -1, 1);
  const ang=Math.acos(dot);
  const arc=6*SAMPLES[1].distanceTo(SAMPLES[0]);
  CURVATURE.push(ang/Math.max(1e-3,arc));
}

// ---------- 程序化沥青纹理 (灰色颗粒感) ----------
function generateAsphaltTexture(){
  const size=512;
  const c=document.createElement('canvas'); c.width=c.height=size;
  const x=c.getContext('2d');
  // 基底: 深灰沥青色
  x.fillStyle='#2a2d32'; x.fillRect(0,0,size,size);
  // 颗粒层: 随机小石子纹理
  for(let i=0;i<15000;i++){
    const px=Math.random()*size, py=Math.random()*size;
    const r=Math.random()*1.8+0.3;
    const b=Math.floor(Math.random()*45+28);
    x.fillStyle=`rgb(${b},${b+2},${b+4})`;
    x.beginPath(); x.arc(px,py,r,0,Math.PI*2); x.fill();
  }
  // 大颗粒: 模拟碎石
  for(let i=0;i<800;i++){
    const px=Math.random()*size, py=Math.random()*size;
    const r=Math.random()*2.5+1;
    const b=Math.floor(Math.random()*30+40);
    x.fillStyle=`rgb(${b},${b+1},${b+3})`;
    x.beginPath(); x.arc(px,py,r,0,Math.PI*2); x.fill();
  }
  // 细微裂纹
  x.strokeStyle='rgba(20,22,28,0.3)'; x.lineWidth=0.5;
  for(let i=0;i<30;i++){
    x.beginPath();
    x.moveTo(Math.random()*size, Math.random()*size);
    x.lineTo(Math.random()*size, Math.random()*size);
    x.stroke();
  }
  const tex=new THREE.CanvasTexture(c);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(60,60);
  tex.anisotropy=4; // 各向异性过滤, 减少远处摩尔纹
  return tex;
}
// ---------- 路面网格 ----------
function buildRoad(){
  const pos=[], uv=[], idx=[];
  for(let i=0;i<NSAMP;i++){
    const p=SAMPLES[i], n=sideNormalAt(i);
    const L=p.clone().addScaledVector(n, HALF_W);
    const R=p.clone().addScaledVector(n,-HALF_W);
    pos.push(L.x,0.02,L.z, R.x,0.02,R.z);
    uv.push(0, i/30, 1, i/30);
  }
  for(let i=0;i<NSAMP;i++){
    const a=i*2,b=a+1,c=((i+1)%NSAMP)*2,d=c+1;
    idx.push(a,b,d, a,d,c);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  const asphaltTex=generateAsphaltTexture();
  const m=new THREE.MeshStandardMaterial({
    color:0x2a2a30, map:asphaltTex,
    roughness:0.55,    // 提高粗糙度, 降低镜面反射 (原0.25)
    metalness:0.05,    // 微降金属感 (原0.5)
    envMapIntensity:0.6 // 降低环境反射 ~40% (原1.0)
  });
  const mesh=new THREE.Mesh(g,m); mesh.receiveShadow=true; return mesh;
}
scene.add(buildRoad());

// ---------- 边线（白）+ 中心虚线 + 起终点 ----------
function buildEdge(side){
  const pos=[],idx=[];
  for(let i=0;i<NSAMP;i++){
    const p=SAMPLES[i], n=sideNormalAt(i);
    const inner=p.clone().addScaledVector(n, side*HALF_W);
    const outer=p.clone().addScaledVector(n, side*(HALF_W+0.6));
    pos.push(inner.x,0.05,inner.z, outer.x,0.05,outer.z);
  }
  for(let i=0;i<NSAMP;i++){const a=i*2,b=a+1,c=((i+1)%NSAMP)*2,d=c+1; idx.push(a,b,d,a,d,c);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xe0e0e0,roughness:0.5,emissive:0x404040,emissiveIntensity:0.3}));
}
scene.add(buildEdge(1)); scene.add(buildEdge(-1));

function buildCenter(){
  const grp=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0xf4d000,roughness:0.5,emissive:0x886600,emissiveIntensity:0.4});
  for(let i=0;i<NSAMP;i+=5){
    const p=SAMPLES[i];
    const ry=Math.atan2(TANGENTS[i].x, TANGENTS[i].z);
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.04,2.0),mat);
    m.position.set(p.x,0.04,p.z);
    m.rotation.y=ry;
    grp.add(m);
  }
  return grp;
}
scene.add(buildCenter());

// ---------- 转弯路牌标识 (弯道前 80m / 40m) ----------
(()=>{
  // 检测弯道起点: 曲率从低到高的过渡点
  const corners = []; // {sampleIdx, direction: 'L'|'R', name}
  const KAPPA_THRESH = 0.008;
  let inCorner = false;
  for(let i=0;i<NSAMP;i++){
    const k = CURVATURE[i];
    if(!inCorner && k > KAPPA_THRESH){
      // 判断方向: 叉积 Y 分量
      const look = 4;
      const t1 = TANGENTS[((i-look)%NSAMP+NSAMP)%NSAMP];
      const t2 = TANGENTS[(i+look)%NSAMP];
      const crossY = t1.x*t2.z - t1.z*t2.x;
      const dir = crossY > 0 ? 'L' : 'R';
      // 查找弯道名称
      let name = '';
      for(const [wpIdx, wpName] of Object.entries(CORNER_NAMES)){
        const sampIdx = Math.floor((parseInt(wpIdx)/N_WP)*NSAMP);
        if(Math.abs(sampIdx - i) < 15) { name = wpName; break; }
      }
      corners.push({ sampleIdx: i, direction: dir, name: name || ('T'+(corners.length+1)) });
      inCorner = true;
    }
    if(k < KAPPA_THRESH * 0.5) inCorner = false;
  }

  // 生成路牌纹理
  function makeSignTexture(text, dir){
    const c=document.createElement('canvas'); c.width=256; c.height=192;
    const x=c.getContext('2d');
    // 背景
    x.fillStyle='#1a2040'; x.fillRect(0,0,256,192);
    x.strokeStyle='#00e5ff'; x.lineWidth=4;
    x.strokeRect(4,4,248,184);
    // 弯道名
    x.fillStyle='#00e5ff'; x.font='bold 36px sans-serif'; x.textAlign='center';
    x.fillText(text, 128, 50);
    // 方向箭头
    x.fillStyle='#ffffff'; x.font='bold 72px sans-serif';
    const arrow = dir === 'L' ? '◄' : '►';
    x.fillText(arrow, 128, 140);
    // 提示文字
    x.fillStyle='#8892a8'; x.font='20px sans-serif';
    x.fillText('SLOW DOWN', 128, 178);
    return new THREE.CanvasTexture(c);
  }

  // 放置路牌
  const signGroup = new THREE.Group();
  const sampleDist = SAMPLES[1].distanceTo(SAMPLES[0]); // 每个采样点间距
  const advance80 = Math.round(80 / sampleDist); // 80m 前
  const advance40 = Math.round(40 / sampleDist); // 40m 前

  for(const corner of corners){
    for(const advance of [advance80, advance40]){
      const signIdx = ((corner.sampleIdx - advance) % NSAMP + NSAMP) % NSAMP;
      const p = SAMPLES[signIdx];
      const n = SIDENORMALS[signIdx];
      // 放在赛道外侧
      const side = corner.direction === 'L' ? 1 : -1; // 左弯道放右侧，反之亦然
      const dist = HALF_W + 2.5;
      const sx = p.x + n.x * side * dist;
      const sz = p.z + n.z * side * dist;
      // 牌面
      const tex = makeSignTexture(corner.name, corner.direction);
      const signMat = new THREE.MeshStandardMaterial({
        map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8,
        roughness: 0.5, side: THREE.DoubleSide
      });
      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), signMat);
      signMesh.position.set(sx, 3.0, sz);
      // 面向赛道
      signMesh.lookAt(p.x, 3.0, p.z);
      signGroup.add(signMesh);
      // 支柱
      const poleMat = new THREE.MeshStandardMaterial({color:0x4a4a5a, metalness:0.6, roughness:0.4});
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), poleMat);
      pole.position.set(sx, 1.5, sz);
      signGroup.add(pole);
    }
  }
  scene.add(signGroup);
})();

function makeChecker(){
  const c=document.createElement('canvas'); c.width=c.height=64;
  const x=c.getContext('2d');
  for(let i=0;i<8;i++)for(let j=0;j<8;j++){x.fillStyle=((i+j)&1)?'#fff':'#111';x.fillRect(i*8,j*8,8,8);}
  return c;
}
(()=>{
  const p=SAMPLES[0];
  const tex=new THREE.CanvasTexture(makeChecker());
  const m=new THREE.Mesh(new THREE.PlaneGeometry(HALF_W*2,3),new THREE.MeshStandardMaterial({map:tex,roughness:0.7}));
  m.rotation.x=-Math.PI/2; m.position.set(p.x,0.06,p.z);
  m.rotation.z = Math.atan2(TANGENTS[0].x, TANGENTS[0].z);
  scene.add(m);
})();

// ============================================================
//  专业围栏系统: TECPRO红白块 + 轮胎墙 + 高碎片围栏
// ============================================================

// --- TECPRO 连续墙体 (红白条纹三角带, 替代分段盒) ---
(()=>{
  // 红白条纹纹理 (画布生成, 每~3m一段红/白)
  const cvs=document.createElement('canvas');
  cvs.width=8; cvs.height=8;
  const ctx=cvs.getContext('2d');
  ctx.fillStyle='#e8e8e8'; ctx.fillRect(0,0,8,8);
  ctx.fillStyle='#d02020'; ctx.fillRect(0,0,4,8);
  const stripeTex=new THREE.CanvasTexture(cvs);
  stripeTex.wrapS=THREE.RepeatWrapping;
  stripeTex.wrapT=THREE.RepeatWrapping;
  stripeTex.repeat.set(NSAMP/6, 1); // 沿赛道重复
  const wallMat=new THREE.MeshStandardMaterial({map:stripeTex, roughness:0.5, metalness:0.1, side:THREE.DoubleSide});

  // 构建连续三角带墙体 (两侧)
  function buildWallRing(offset, height){
    const pos=[], idx=[];
    for(let side=-1; side<=1; side+=2){
      const base=pos.length/3;
      for(let i=0;i<=NSAMP;i++){
        const ii=i%NSAMP;
        const p=SAMPLES[ii], n=sideNormalAt(ii);
        const x=p.x+n.x*side*(HALF_W+offset);
        const z=p.z+n.z*side*(HALF_W+offset);
        pos.push(x, 0, z);       // 底
        pos.push(x, height, z);  // 顶
      }
      for(let i=0;i<NSAMP;i++){
        const a=base+i*2, b=base+i*2+1, c=base+i*2+2, d=base+i*2+3;
        idx.push(a,b,c, b,d,c);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m=new THREE.Mesh(g, wallMat);
    m.castShadow=true; m.receiveShadow=true;
    return m;
  }
  // TECPRO 主墙: 高1.2m, offset 0.8 (与WALL_DIST一致)
  scene.add(buildWallRing(WALL_OFFSET, 1.2));
})();

// --- 轮胎墙 (弯道处, TECPRO后方) ---
(()=>{
  const tireGeo=new THREE.TorusGeometry(0.35, 0.15, 6, 12);
  const tireMat=new THREE.MeshStandardMaterial({color:0x111114, roughness:0.95});
  const tirePositions=[];
  for(let i=0;i<NSAMP;i++){
    // 仅在弯道处放轮胎墙 (曲率高)
    const ahead=TANGENTS[(i+8)%NSAMP];
    const cur=TANGENTS[i];
    const dot=ahead.x*cur.x+ahead.z*cur.z;
    if(dot<0.96){ tirePositions.push(i); } // 弯道
  }
  const total=tirePositions.length*2; // 两侧
  const mL=new THREE.InstancedMesh(tireGeo,tireMat,total);
  const mR=new THREE.InstancedMesh(tireGeo,tireMat,total);
  const d=new THREE.Object3D();
  let li=0, ri=0;
  for(const i of tirePositions){
    const p=SAMPLES[i], n=sideNormalAt(i);
    const ry=Math.atan2(TANGENTS[i].x,TANGENTS[i].z);
    // 双层轮胎
    for(const layer of [0,1]){
      d.position.set(p.x+n.x*(HALF_W+2.2+layer*0.7), 0.4+layer*0.5, p.z+n.z*(HALF_W+2.2+layer*0.7));
      d.rotation.y=ry; d.updateMatrix(); mL.setMatrixAt(li++,d.matrix);
      d.position.set(p.x-n.x*(HALF_W+2.2+layer*0.7), 0.4+layer*0.5, p.z-n.z*(HALF_W+2.2+layer*0.7));
      d.updateMatrix(); mR.setMatrixAt(ri++,d.matrix);
    }
  }
  mL.count=li; mR.count=ri;
  mL.instanceMatrix.needsUpdate=true; mR.instanceMatrix.needsUpdate=true;
  mL.castShadow=true; mR.castShadow=true;
  scene.add(mL); scene.add(mR);
})();

// --- 高碎片围栏 (3.5m高钢丝网, 围栏上方) ---
(()=>{
  const N=NSAMP;
  const postGeo=new THREE.BoxGeometry(0.15, 4.0, 0.15);
  const fenceMat=new THREE.MeshStandardMaterial({color:0x888899, roughness:0.6, metalness:0.4, transparent:true, opacity:0.35, side:THREE.DoubleSide});
  // 围栏柱 (每4个采样点一根)
  const postCount=Math.floor(N/4)*2;
  const mPosts=new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({color:0x666677,roughness:0.5,metalness:0.5}), postCount);
  const d=new THREE.Object3D();
  let pi=0;
  for(let i=0;i<N;i+=4){
    const p=SAMPLES[i], n=sideNormalAt(i);
    // Left post
    d.position.set(p.x+n.x*(HALF_W+1.5), 2.0, p.z+n.z*(HALF_W+1.5));
    d.rotation.y=Math.atan2(TANGENTS[i].x,TANGENTS[i].z);
    d.updateMatrix(); mPosts.setMatrixAt(pi++,d.matrix);
    // Right post
    d.position.set(p.x-n.x*(HALF_W+1.5), 2.0, p.z-n.z*(HALF_W+1.5));
    d.updateMatrix(); mPosts.setMatrixAt(pi++,d.matrix);
  }
  mPosts.count=pi; mPosts.instanceMatrix.needsUpdate=true; mPosts.castShadow=true;
  scene.add(mPosts);
})();

// ============================================================
//  观众席 (阶梯式 + 人群纹理 + 屋顶)
// ============================================================
function makeCrowdTexture(){
  const c=document.createElement('canvas'); c.width=256; c.height=128;
  const x=c.getContext('2d');
  x.fillStyle='#1a1a30'; x.fillRect(0,0,256,128);
  const cols=['#ff5533','#ffee00','#00e5ff','#ff2bd6','#22ff88','#ffffff','#ff8800','#aa66ff','#ff44aa','#44ddff'];
  // 更密集的人群 (500+ 点)
  for(let i=0;i<600;i++){
    x.fillStyle=cols[Math.floor(Math.random()*cols.length)];
    x.globalAlpha=0.7+Math.random()*0.3;
    x.fillRect(Math.random()*256, Math.random()*128, 2.5, 3.5);
  }
  // 亮色高光 (萤光棒效果)
  for(let i=0;i<30;i++){
    x.fillStyle=cols[Math.floor(Math.random()*cols.length)];
    x.globalAlpha=0.9;
    x.fillRect(Math.random()*256, Math.random()*128, 4, 5);
  }
  x.globalAlpha=1;
  return c;
}
function buildGrandstand(x, z, rotY){
  const grp=new THREE.Group();
  const structMat=new THREE.MeshStandardMaterial({color:0x2a2a3e, roughness:0.7, metalness:0.3});
  const crowdTex=new THREE.CanvasTexture(makeCrowdTexture());
  const crowdMat=new THREE.MeshStandardMaterial({map:crowdTex, emissive:0x333355, emissiveIntensity:0.6, roughness:0.9});
  const roofMat=new THREE.MeshStandardMaterial({color:0x1a1a2a, roughness:0.6, metalness:0.4});
  const TIERS=10;
  // 阶梯座位 (10 层, 逐层升高)
  for(let t=0;t<TIERS;t++){
    const tier=new THREE.Mesh(new THREE.BoxGeometry(36,1.2,3),structMat);
    tier.position.set(0, 0.6+t*2.0, -t*3-2);
    tier.castShadow=false; tier.receiveShadow=true;
    grp.add(tier);
    // 人群 (更大更密)
    const crowd=new THREE.Mesh(new THREE.BoxGeometry(34,0.6,2.5),crowdMat);
    crowd.position.set(0, 1.4+t*2.0, -t*3-2);
    grp.add(crowd);
  }
  // 屋顶
  const roof=new THREE.Mesh(new THREE.BoxGeometry(38,0.6,8),roofMat);
  roof.position.set(0, 1+TIERS*2.0+3, -TIERS*3/2-2);
  roof.castShadow=false;
  grp.add(roof);
  // 支柱
  for(const px of [-17,0,17]){
    const pillar=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,TIERS*2.0+8,6),structMat);
    pillar.position.set(px,(TIERS*2.0+8)/2,-1); pillar.castShadow=false;
    grp.add(pillar);
  }
  // LED 广告板 (更亮)
  const led=new THREE.Mesh(new THREE.BoxGeometry(36,1.2,0.2),
    new THREE.MeshStandardMaterial({color:0x0044aa, emissive:0x0066ff, emissiveIntensity:2.0}));
  led.position.set(0,1.2,-1.5);
  grp.add(led);
  // 第二块 LED (底部, 球队广告)
  const led2=new THREE.Mesh(new THREE.BoxGeometry(36,0.6,0.2),
    new THREE.MeshStandardMaterial({color:0xaa0044, emissive:0xff2266, emissiveIntensity:1.8}));
  led2.position.set(0,3.2,-1.5);
  grp.add(led2);

  grp.position.set(x,0,z); grp.rotation.y=rotY;
  return grp;
}
// 放置观众席 (更多座, 更大)
scene.add(buildGrandstand(-300, 370, Math.PI));      // 发车直道外侧 (主看台)
scene.add(buildGrandstand(188, 270, Math.PI/2));       // T1发夹 (修正: 面东朝鼓包)
scene.add(buildGrandstand(-15, -185, 0));             // 北侧直道 (不变)
scene.add(buildGrandstand(-330, 82, 0));              // 西侧直道 (修正: 面北朝T15/T16)
scene.add(buildGrandstand(100, -140, Math.PI));       // T9附近 (修正: 面北朝减速弯)
scene.add(buildGrandstand(-120, 160, 0));             // T12附近 (修正: 面北朝T12发夹)

// ============================================================
//  隧道结构 (赛道上方覆盖, 内部灯)
// ============================================================
function buildTunnel(startIdx, endIdx){
  const grp=new THREE.Group();
  const tunnelMat=new THREE.MeshStandardMaterial({color:0x2a2a3e, roughness:0.7, metalness:0.3, side:THREE.DoubleSide});
  const lightStripMat=new THREE.MeshStandardMaterial({color:0xfff8e0, emissive:0xfff8e0, emissiveIntensity:3.0});
  const supportMat=new THREE.MeshStandardMaterial({color:0x444455, metalness:0.5, roughness:0.5});
  for(let i=startIdx;i<endIdx;i++){
    const p=SAMPLES[i], n=sideNormalAt(i);
    const ry=Math.atan2(TANGENTS[i].x,TANGENTS[i].z);
    // 拱形顶部 (半圆筒)
    const arch=new THREE.Mesh(new THREE.CylinderGeometry(HALF_W+2.5, HALF_W+2.5, 3, 12, 1, false, 0, Math.PI), tunnelMat);
    arch.rotation.z=Math.PI/2;
    arch.rotation.y=ry;
    arch.position.set(p.x, 4.5, p.z);
    arch.castShadow=true; arch.receiveShadow=true;
    grp.add(arch);
    // 内部灯条 (每3个采样点)
    if(i%3===0){
      const strip=new THREE.Mesh(new THREE.BoxGeometry(HALF_W*2, 0.2, 0.4), lightStripMat);
      strip.position.set(p.x, 4.2, p.z);
      strip.rotation.y=ry;
      grp.add(strip);
      // 隧道内点光源
      const tl=new THREE.PointLight(0xfff8e0, 2.5, 50, 2);
      tl.position.set(p.x, 3.5, p.z);
      grp.add(tl);
    }
    // 支撑柱 (每5个采样点)
    if(i%5===0){
      for(const s of [1,-1]){
        const post=new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6), supportMat);
        post.position.set(p.x+n.x*s*(HALF_W+2.5), 2.5, p.z+n.z*s*(HALF_W+2.5));
        post.castShadow=true;
        grp.add(post);
      }
    }
  }
  // 隧道入口/出口标志
  for(const idx of [startIdx, endIdx-1]){
    const p=SAMPLES[idx], n=sideNormalAt(idx);
    const ry=Math.atan2(TANGENTS[idx].x,TANGENTS[idx].z);
    const sign=new THREE.Mesh(new THREE.BoxGeometry(HALF_W*2+5, 1, 0.3),
      new THREE.MeshStandardMaterial({color:0x222230, emissive:0x222230, emissiveIntensity:0.3}));
    sign.position.set(p.x, 6.5, p.z);
    sign.rotation.y=ry;
    grp.add(sign);
  }
  return grp;
}
// 隧道放置: Raffles Blvd 长直道段 (采样点 31~35)
scene.add(buildTunnel(31, 36));

// ============================================================
//  真实 F1 2025 赛季 车队/车手/车号/涂色 (必须在 pit lane 建模之前)
// ============================================================
const TEAMS = [
  { short:'MCL', name:'McLaren',     color:0xFF8000, accent:0x000000, driver:'NOR', num:4  },
  { short:'RBR', name:'Red Bull',    color:0x3671C6, accent:0xFFCC00, driver:'VER', num:1  },
  { short:'FER', name:'Ferrari',     color:0xE80020, accent:0xFFFFFF, driver:'LEC', num:16 },
  { short:'MER', name:'Mercedes',    color:0x27F4D2, accent:0x111111, driver:'RUS', num:63 },
  { short:'FER', name:'Ferrari',     color:0xE80020, accent:0xFFFFFF, driver:'HAM', num:44 },
  { short:'MCL', name:'McLaren',     color:0xFF8000, accent:0x000000, driver:'PIA', num:81 },
  { short:'WIL', name:'Williams',    color:0x64C4FF, accent:0x041E42, driver:'SAI', num:55 },
  { short:'AST', name:'Aston Martin',color:0x00665E, accent:0xCEDC00, driver:'ALO', num:14 },
  { short:'MER', name:'Mercedes',    color:0x27F4D2, accent:0x111111, driver:'ANT', num:12 },
  { short:'ALP', name:'Alpine',      color:0x0090FF, accent:0xFF87BC, driver:'GAS', num:10 },
  { short:'WIL', name:'Williams',    color:0x64C4FF, accent:0x041E42, driver:'ALB', num:23 },
  { short:'RBR', name:'Red Bull',    color:0x3671C6, accent:0xFFCC00, driver:'TSU', num:22 },
];
const NCARS = TEAMS.length;

// ============================================================
//  维修区通道 (Pit Lane) — 主直道右侧 (南侧)
//  布局: 赛道(z=340) → 开放入口 → 内墙段(z=323~328, 有开口) → 通道(z=318) → 外墙(z=313) → 维修站(z=300)
// ============================================================
const PIT_LANE_Z = 318;       // 维修通道中心 z 坐标
const PIT_LANE_HALF_W = 5;    // 维修通道半宽 (10m 宽)
const PIT_ENTRY_X = -340;     // 入口 x 坐标
const PIT_EXIT_X = 40;        // 出口 x 坐标
const PIT_SPEED_LIMIT = 22;   // 80 km/h ≈ 22 m/s
const pitGroup = new THREE.Group();

// 维修通道地面 + 入口/出口斜道 + 墙壁 (带开口) + 维修站点
(()=>{
  const pitLen = PIT_EXIT_X - PIT_ENTRY_X; // ~380m
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.6, metalness: 0.3 });

  // 维修通道地面
  const pitRoad = new THREE.Mesh(
    new THREE.PlaneGeometry(pitLen, PIT_LANE_HALF_W * 2),
    new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.7, metalness: 0.05 })
  );
  pitRoad.rotation.x = -Math.PI / 2;
  pitRoad.position.set((PIT_ENTRY_X + PIT_EXIT_X) / 2, 0.015, PIT_LANE_Z);
  pitRoad.receiveShadow = true;
  pitGroup.add(pitRoad);

  // 入口斜道 (从主赛道连到维修通道)
  const entryShape = new THREE.Shape();
  entryShape.moveTo(0, 0);
  entryShape.lineTo(-30, 0);
  entryShape.lineTo(-10, -(340 - PIT_LANE_Z - PIT_LANE_HALF_W));
  entryShape.lineTo(0, -(340 - PIT_LANE_Z - PIT_LANE_HALF_W));
  const entryGeo = new THREE.ShapeGeometry(entryShape);
  const entryMesh = new THREE.Mesh(entryGeo, new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.7 }));
  entryMesh.rotation.x = -Math.PI / 2;
  entryMesh.position.set(PIT_ENTRY_X, 0.015, 340);
  pitGroup.add(entryMesh);

  // 出口斜道
  const exitShape = new THREE.Shape();
  exitShape.moveTo(0, 0);
  exitShape.lineTo(30, 0);
  exitShape.lineTo(10, -(340 - PIT_LANE_Z - PIT_LANE_HALF_W));
  exitShape.lineTo(0, -(340 - PIT_LANE_Z - PIT_LANE_HALF_W));
  const exitGeo = new THREE.ShapeGeometry(exitShape);
  const exitMesh = new THREE.Mesh(exitGeo, new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.7 }));
  exitMesh.rotation.x = -Math.PI / 2;
  exitMesh.position.set(PIT_EXIT_X, 0.015, 340);
  pitGroup.add(exitMesh);

  // === 内侧墙 (靠近赛道一侧, z=323) — 分段建造, 留出入口/出口开口 ===
  const innerWallZ = PIT_LANE_Z + PIT_LANE_HALF_W + 0.15; // z=323.15
  const entryGap = 25;  // 入口开口宽度
  const exitGap = 25;   // 出口开口宽度
  const wallH = 1.2;
  // 入口前墙段 (从赛道起点到入口开口)
  const preWallLen = 20; // 入口前的短墙
  const innerWall1 = new THREE.Mesh(new THREE.BoxGeometry(preWallLen, wallH, 0.3), wallMat);
  innerWall1.position.set(PIT_ENTRY_X - entryGap/2 - preWallLen/2, wallH/2, innerWallZ);
  pitGroup.add(innerWall1);
  // 入口到出口之间的长墙段
  const midWallLen = PIT_EXIT_X - PIT_ENTRY_X - entryGap - exitGap;
  const midWallStart = PIT_ENTRY_X + entryGap/2;
  const innerWall2 = new THREE.Mesh(new THREE.BoxGeometry(midWallLen, wallH, 0.3), wallMat);
  innerWall2.position.set(midWallStart + midWallLen/2, wallH/2, innerWallZ);
  pitGroup.add(innerWall2);
  // 出口后墙段
  const innerWall3 = new THREE.Mesh(new THREE.BoxGeometry(30, wallH, 0.3), wallMat);
  innerWall3.position.set(PIT_EXIT_X + exitGap/2 + 15, wallH/2, innerWallZ);
  pitGroup.add(innerWall3);

  // 外侧墙 (z=313, 连续无开口)
  const outerWall = new THREE.Mesh(new THREE.BoxGeometry(pitLen + 60, 1.0, 0.3), wallMat);
  outerWall.position.set((PIT_ENTRY_X + PIT_EXIT_X) / 2, 0.5, PIT_LANE_Z - PIT_LANE_HALF_W - 0.15);
  pitGroup.add(outerWall);

  // === 维修位标记 (NCARS 个车队) + 维修作业站点 ===
  const teamColors = TEAMS.map(t => t.color);
  const pitBoxSpacing = pitLen / (NCARS + 2);
  for(let i = 0; i < NCARS; i++){
    const bx = PIT_ENTRY_X + pitBoxSpacing * (i + 1.5);
    // 维修位地面标记
    const boxMark = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 3),
      new THREE.MeshStandardMaterial({
        color: teamColors[i], emissive: teamColors[i], emissiveIntensity: 0.3,
        roughness: 0.5, transparent: true, opacity: 0.6
      })
    );
    boxMark.rotation.x = -Math.PI / 2;
    boxMark.position.set(bx, 0.02, PIT_LANE_Z - PIT_LANE_HALF_W + 3); // 靠建筑侧
    pitGroup.add(boxMark);

    // 维修位编号
    const numCanvas = document.createElement('canvas');
    numCanvas.width = 64; numCanvas.height = 64;
    const nctx = numCanvas.getContext('2d');
    nctx.fillStyle = '#' + teamColors[i].toString(16).padStart(6, '0');
    nctx.font = 'bold 40px sans-serif';
    nctx.textAlign = 'center';
    nctx.fillText((i + 1).toString(), 32, 45);
    const numTex = new THREE.CanvasTexture(numCanvas);
    const numPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true })
    );
    numPlane.rotation.x = -Math.PI / 2;
    numPlane.position.set(bx, 0.025, PIT_LANE_Z - PIT_LANE_HALF_W + 3); // 靠建筑侧
    pitGroup.add(numPlane);

    // === 维修作业站点 ===
    // 1. 轮胎架 (在维修位外侧)
    const tireRackMat = new THREE.MeshStandardMaterial({color:0x2a2a3a, roughness:0.8, metalness:0.2});
    const tireRack = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 0.4), tireRackMat);
    tireRack.position.set(bx, 0.6, PIT_LANE_Z - PIT_LANE_HALF_W + 0.5);
    pitGroup.add(tireRack);
    // 轮胎架上放4个轮胎 (车队色)
    const tireOnRackMat = new THREE.MeshStandardMaterial({color:teamColors[i], roughness:0.9});
    for(let t=0; t<4; t++){
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), tireOnRackMat);
      tire.rotation.x = Math.PI/2;
      tire.position.set(bx - 0.6 + t*0.4, 0.85, PIT_LANE_Z - PIT_LANE_HALF_W + 0.5);
      pitGroup.add(tire);
    }

    // 2. 千斤顶 (在维修位前方)
    const jackMat = new THREE.MeshStandardMaterial({color:0xcc3300, metalness:0.6, roughness:0.4});
    const jack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), jackMat);
    jack.position.set(bx - 1.5, 0.25, PIT_LANE_Z);
    pitGroup.add(jack);

    // 3. 燃油加注机 (在维修位后方)
    const fuelMat = new THREE.MeshStandardMaterial({color:0x444455, metalness:0.5, roughness:0.5});
    const fuelRig = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.5, 8), fuelMat);
    fuelRig.position.set(bx + 1.8, 0.75, PIT_LANE_Z - PIT_LANE_HALF_W + 1.0);
    pitGroup.add(fuelRig);
    // 燃油管
    const hoseMat = new THREE.MeshStandardMaterial({color:0x333333, roughness:0.9});
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 6), hoseMat);
    hose.position.set(bx + 1.2, 0.5, PIT_LANE_Z - PIT_LANE_HALF_W + 1.5);
    hose.rotation.z = Math.PI/4;
    pitGroup.add(hose);

    // 4. 工具柜 (在维修位旁)
    const equipMat = new THREE.MeshStandardMaterial({color:0x555566, metalness:0.4, roughness:0.5});
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), equipMat);
    cabinet.position.set(bx + 2.5, 0.5, PIT_LANE_Z);
    pitGroup.add(cabinet);

    // 5. 维修团队人员 (简化为彩色圆柱体)
    const crewColors = [0xff6644, 0x44aaff, 0xffaa00, 0x44ff44, 0xaa44ff, 0xff44aa];
    for(let p=0; p<4; p++){
      const crewMat = new THREE.MeshStandardMaterial({color:crewColors[p%6], roughness:0.7});
      const crew = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.6, 6), crewMat);
      const ang = (p / 4) * Math.PI * 2;
      crew.position.set(bx + Math.cos(ang)*1.0, 0.8, PIT_LANE_Z + Math.sin(ang)*0.8);
      pitGroup.add(crew);
      // 头
      const headMat = new THREE.MeshStandardMaterial({color:0xffccaa, roughness:0.6});
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), headMat);
      head.position.set(bx + Math.cos(ang)*1.0, 1.7, PIT_LANE_Z + Math.sin(ang)*0.8);
      pitGroup.add(head);
    }
  }

  // 限速标志 (入口处)
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 128; signCanvas.height = 128;
  const sctx = signCanvas.getContext('2d');
  sctx.fillStyle = '#ffffff'; sctx.beginPath(); sctx.arc(64, 64, 58, 0, Math.PI * 2); sctx.fill();
  sctx.fillStyle = '#ff0000'; sctx.beginPath(); sctx.arc(64, 64, 52, 0, Math.PI * 2); sctx.fill();
  sctx.fillStyle = '#ffffff'; sctx.font = 'bold 36px sans-serif'; sctx.textAlign = 'center';
  sctx.fillText('80', 64, 72);
  const signTex = new THREE.CanvasTexture(signCanvas);
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.5 })
  );
  signMesh.position.set(PIT_ENTRY_X + 5, 2.5, PIT_LANE_Z + PIT_LANE_HALF_W + 0.5);
  signMesh.rotation.y = -Math.PI / 2;
  pitGroup.add(signMesh);

  // "PIT LANE" 地面文字 (入口处)
  const pitTextCanvas = document.createElement('canvas');
  pitTextCanvas.width = 256; pitTextCanvas.height = 64;
  const ptx = pitTextCanvas.getContext('2d');
  ptx.fillStyle = '#ffffff';
  ptx.font = 'bold 40px sans-serif'; ptx.textAlign = 'center';
  ptx.fillText('PIT LANE', 128, 45);
  const pitTextTex = new THREE.CanvasTexture(pitTextCanvas);
  const pitText = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    new THREE.MeshBasicMaterial({ map: pitTextTex, transparent: true })
  );
  pitText.rotation.x = -Math.PI / 2;
  pitText.position.set(PIT_ENTRY_X + 20, 0.03, 335);
  pitGroup.add(pitText);
})();
scene.add(pitGroup);

// 维修区检测: 判断车辆是否在维修通道内 (扩大范围, 包含入口/出口斜道)
function isInPitLane(pos){
  // 维修通道主体范围
  if(pos.x > PIT_ENTRY_X - 15 && pos.x < PIT_EXIT_X + 15 &&
     pos.z > PIT_LANE_Z - PIT_LANE_HALF_W - 3 && pos.z < PIT_LANE_Z + PIT_LANE_HALF_W + 3){
    return true;
  }
  // 入口斜道范围 (从赛道 z=340 到通道 z=323)
  if(pos.x > PIT_ENTRY_X - 20 && pos.x < PIT_ENTRY_X + 35 &&
     pos.z > PIT_LANE_Z + PIT_LANE_HALF_W && pos.z < 342){
    return true;
  }
  // 出口斜道范围
  if(pos.x > PIT_EXIT_X - 35 && pos.x < PIT_EXIT_X + 20 &&
     pos.z > PIT_LANE_Z + PIT_LANE_HALF_W && pos.z < 342){
    return true;
  }
  return false;
}

// ---------- 工具函数: 最近采样点 + 最近线段 (提前定义供建筑验证使用) ----------
function nearestSample(p){
  let best=0,bd=1e9;
  const lastIdx = (p._lastSampleIdx != null) ? p._lastSampleIdx : -1;
  if(lastIdx >= 0){
    const RANGE = 40;
    for(let di=-RANGE;di<=RANGE;di++){
      const i = ((lastIdx+di)%NSAMP+NSAMP)%NSAMP;
      const s=SAMPLES[i];
      const dx=p.x-s.x, dz=p.z-s.z;
      const d=dx*dx+dz*dz;
      if(d<bd){bd=d;best=i;}
    }
    if(bd > 2500){
      for(let i=0;i<NSAMP;i++){
        const s=SAMPLES[i];
        const dx=p.x-s.x, dz=p.z-s.z;
        const d=dx*dx+dz*dz;
        if(d<bd){bd=d;best=i;}
      }
    }
  } else {
    for(let i=0;i<NSAMP;i++){
      const s=SAMPLES[i];
      const dx=p.x-s.x, dz=p.z-s.z;
      const d=dx*dx+dz*dz;
      if(d<bd){bd=d;best=i;}
    }
  }
  p._lastSampleIdx = best;
  return {idx:best, dist:Math.sqrt(bd)};
}
function nearestSegment(p){
  const near = nearestSample(p);
  let i = near.idx;
  const a = SAMPLES[i], b = SAMPLES[(i+1)%NSAMP];
  const seg = new THREE.Vector3().subVectors(b,a);
  const segLen2 = Math.max(1e-6, seg.lengthSq());
  let t = new THREE.Vector3().subVectors(p,a).dot(seg)/segLen2;
  t = THREE.MathUtils.clamp(t, 0, 1);
  const center = a.clone().addScaledVector(seg, t);
  const tan = TANGENTS[i].clone().lerp(TANGENTS[(i+1)%NSAMP], t).normalize();
  const nrm = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
  const toCar = new THREE.Vector3().subVectors(p, center);
  const lateral = toCar.dot(nrm);
  return { i, t, center, tangent:tan, normal:nrm, lateral, absLat:Math.abs(lateral) };
}

// ============================================================
//  城市建筑 (夜景亮窗)
// ============================================================
function makeBuildingTexture(){
  const c=document.createElement('canvas'); c.width=64; c.height=128;
  const x=c.getContext('2d');
  x.fillStyle='#080a14'; x.fillRect(0,0,64,128);
  for(let row=0;row<16;row++){
    for(let col=0;col<6;col++){
      if(Math.random()>0.4){
        const warm=Math.random()>0.3;
        x.fillStyle = warm ? `hsl(${40+Math.random()*15},85%,${55+Math.random()*25}%)`
                           : `hsl(${200+Math.random()*30},70%,${50+Math.random()*25}%)`;
        x.fillRect(col*10+3, row*8+2, 6, 5);
      }
    }
  }
  return c;
}
function buildCity(){
  const grp=new THREE.Group();
  const textures=[];
  for(let i=0;i<4;i++) textures.push(new THREE.CanvasTexture(makeBuildingTexture()));
  const buildingMats=textures.map(tex=>new THREE.MeshStandardMaterial({
    color:0x12182a, emissive:0xffffff, emissiveMap:tex, emissiveIntensity:1.0, roughness:0.8
  }));
  const darkMat=new THREE.MeshStandardMaterial({color:0x0a0a16, roughness:0.9});

  // 建筑放置验证: 确保不侵入赛道
  function validateBuildingPos(bx, bz, halfSize){
    const testPos = new THREE.Vector3(bx, 0, bz);
    const near = nearestSegment(testPos);
    const requiredDist = WALL_DIST + halfSize + 3.0; // 围栏外 + 建筑半径 + 3m余量
    if(near.absLat < requiredDist){
      // 沿法线外推到安全距离
      const push = requiredDist - near.absLat;
      const sign = Math.sign(near.lateral) || 1;
      return { x: bx + near.normal.x * sign * push, z: bz + near.normal.z * sign * push };
    }
    return { x: bx, z: bz };
  }
  for(let i=2;i<NSAMP;i+=6){
    const p=SAMPLES[i], n=sideNormalAt(i);
    const ry=Math.atan2(TANGENTS[i].x,TANGENTS[i].z);
    for(const side of [1,-1]){
      if(Math.random()<0.7){
        const dist=HALF_W+15+Math.random()*10; // 增大最小距离: 12→15
        const bx=p.x+n.x*side*dist;
        const bz=p.z+n.z*side*dist;
        const h=12+Math.random()*45;
        const w=6+Math.random()*6;
        const dp=6+Math.random()*6;
        // 验证并修正位置
        const corrected = validateBuildingPos(bx, bz, Math.max(w,dp)*0.5);
        const mat=Math.random()<0.8?buildingMats[Math.floor(Math.random()*buildingMats.length)]:darkMat;
        const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,dp),mat);
        b.position.set(corrected.x,h/2,corrected.z);
        b.rotation.y=ry;
        b.castShadow=false; b.receiveShadow=true;
        grp.add(b);
      }
    }
  }
  return grp;
}
scene.add(buildCity());

// --- 泛光灯柱 (沿赛道, 夜赛灯光 — 更密更亮) ---
(()=>{
  const poleMat=new THREE.MeshStandardMaterial({color:0x4a4a5a, metalness:0.6, roughness:0.4});
  const lightMat=new THREE.MeshStandardMaterial({color:0xfff8e0, emissive:0xfff8e0, emissiveIntensity:3.0});
  const coneMat=new THREE.MeshBasicMaterial({color:0xfff4cc, transparent:true, opacity:0.06, side:THREE.DoubleSide, depthWrite:false});
  let plightCount=0;
  const MAX_PLIGHTS=30;
  for(let i=0;i<NSAMP;i+=30){
    const p=SAMPLES[i], n=sideNormalAt(i);
    for(const side of [1,-1]){
      if(Math.random()<0.6){
        const dist=HALF_W+5;
        const px=p.x+n.x*side*dist;
        const pz=p.z+n.z*side*dist;
        // 灯柱
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.3,16,6),poleMat);
        pole.position.set(px,8,pz); pole.castShadow=true;
        scene.add(pole);
        // 灯面板 (更亮)
        const panel=new THREE.Mesh(new THREE.BoxGeometry(3.5,1.8,0.3),lightMat);
        panel.position.set(px,16,pz);
        panel.lookAt(p.x, 0, p.z);
        scene.add(panel);
        // 可见光锥
        const cone=new THREE.Mesh(new THREE.ConeGeometry(7,14,8,1,true),coneMat);
        cone.position.set(px,9,pz);
        cone.lookAt(p.x, -2, p.z);
        cone.rotateX(-Math.PI/2);
        scene.add(cone);
        // 点光源 (更亮更远)
        if(plightCount<MAX_PLIGHTS){
          const pl=new THREE.PointLight(0xfff8e0, 2.0, 180, 1.5);
          pl.position.set(px,15,pz);
          scene.add(pl);
          plightCount++;
        }
      }
    }
  }
})();

// ============================================================
//  地标: 新加坡摩天轮 + 金沙酒店三塔
// ============================================================

// 摩天轮 (Singapore Flyer)
(()=>{
  const grp=new THREE.Group();
  const structMat=new THREE.MeshStandardMaterial({color:0x333344, metalness:0.5, roughness:0.5});
  const ledMat=new THREE.MeshStandardMaterial({color:0xff4488, emissive:0xff4488, emissiveIntensity:2.0});
  // 轮
  const wheel=new THREE.Mesh(new THREE.TorusGeometry(22,0.8,8,48),structMat);
  wheel.rotation.x=Math.PI/2; wheel.position.y=24; wheel.castShadow=true;
  grp.add(wheel);
  // 辐条
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2;
    const spoke=new THREE.Mesh(new THREE.BoxGeometry(0.4,21,0.4),structMat);
    spoke.position.set(Math.cos(a)*10.5,24,Math.sin(a)*10.5);
    spoke.rotation.z=a-Math.PI/2;
    grp.add(spoke);
  }
  // 支架
  const s1=new THREE.Mesh(new THREE.BoxGeometry(1,24,1),structMat);
  s1.position.set(0,12,-3); grp.add(s1);
  const s2=s1.clone(); s2.position.z=3; grp.add(s2);
  // LED 灯环
  const led=new THREE.Mesh(new THREE.TorusGeometry(22.5,0.3,6,48),ledMat);
  led.rotation.x=Math.PI/2; led.position.y=24;
  grp.add(led);
  grp.position.set(250,-330,0);
  scene.add(grp);
  // 缓慢旋转
  grp.userData.spin=()=>{ wheel.rotation.z+=0.002; };
  scene.userData.flyer=grp;
})();

// 金沙酒店 (Marina Bay Sands 三塔)
(()=>{
  const grp=new THREE.Group();
  const towerMat=new THREE.MeshStandardMaterial({color:0x1a1a2e, metalness:0.3, roughness:0.6, emissive:0x0a0a14, emissiveIntensity:0.3});
  for(let i=0;i<3;i++){
    const tower=new THREE.Mesh(new THREE.BoxGeometry(16,70,16),towerMat);
    tower.position.set(i*20-20,35,0); tower.castShadow=true; tower.receiveShadow=true;
    grp.add(tower);
    // 窗户灯
    const winTex=new THREE.CanvasTexture(makeBuildingTexture());
    const winMat=new THREE.MeshStandardMaterial({emissive:0xffffff,emissiveMap:winTex,emissiveIntensity:0.8,transparent:true,opacity:0.6});
    const win=new THREE.Mesh(new THREE.BoxGeometry(16.1,70.1,16.1),winMat);
    win.position.copy(tower.position);
    grp.add(win);
  }
  // 顶部空中花园
  const skyPark=new THREE.Mesh(new THREE.BoxGeometry(58,4,14),towerMat);
  skyPark.position.set(0,72,0); skyPark.castShadow=true;
  grp.add(skyPark);
  grp.position.set(-150,-180,-400);
  grp.rotation.y=0.3;
  scene.add(grp);
})();

// --- 水面 (Marina Bay) ---
(()=>{
  const water=new THREE.Mesh(
    new THREE.PlaneGeometry(500,350),
    new THREE.MeshStandardMaterial({color:0x1a3a55, metalness:0.9, roughness:0.05, transparent:true, opacity:0.8})
  );
  water.rotation.x=-Math.PI/2;
  water.position.set(-100,-0.01,50);
  water.receiveShadow=true;
  scene.add(water);
})();

// ============================================================
//  F1 赛车 (基本体) — nose 朝 +Z
// ============================================================
function buildF1Car(color, team, isPlayer){
  const g=new THREE.Group();
  const body=new THREE.MeshStandardMaterial({color, metalness:0.55, roughness:0.3, emissive:color, emissiveIntensity:0.08});
  const dark=new THREE.MeshStandardMaterial({color:0x111114, metalness:0.6, roughness:0.3});
  const tire=new THREE.MeshStandardMaterial({color:0x1a1a1c, roughness:0.95});
  const carbon=new THREE.MeshStandardMaterial({color:0x2a2a30, metalness:0.7, roughness:0.4});
  const rimMat=new THREE.MeshStandardMaterial({color:0x888888, metalness:0.9, roughness:0.2});

  // 车身纹理 (车队名 + 车手号)
  let sidepodMat=body;
  if(team){
    const tex=new THREE.CanvasTexture(makeCarTexture(team, isPlayer));
    sidepodMat=new THREE.MeshStandardMaterial({map:tex, metalness:0.4, roughness:0.35, emissive:color, emissiveIntensity:0.1});
  }

  // === 底盘 (更流线型) ===
  // 单体壳 (cockpit区域)
  const monocoque=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.3,1.8),body);
  monocoque.position.set(0,0.32,0.2); monocoque.castShadow=true; g.add(monocoque);
  // 前部收窄
  const frontBody=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.25,0.8),body);
  frontBody.position.set(0,0.31,1.2); frontBody.castShadow=true; g.add(frontBody);
  // 后部引擎盖
  const engineCover=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.28,0.9),body);
  engineCover.position.set(0,0.33,-0.7); engineCover.castShadow=true; g.add(engineCover);
  // 侧箱 (更宽更真实)
  const sidepod=new THREE.Mesh(new THREE.BoxGeometry(1.1,0.32,1.2),sidepodMat);
  sidepod.position.set(0,0.30,0.1); sidepod.castShadow=true; g.add(sidepod);
  // 侧箱进气口
  const intake1=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.2,0.1),dark);
  intake1.position.set(0.55,0.35,0.6); g.add(intake1);
  const intake2=intake1.clone(); intake2.position.x=-0.55; g.add(intake2);

  // === 鼻锥 (更尖锐) ===
  const nose=new THREE.Mesh(new THREE.ConeGeometry(0.14,1.0,8),body);
  nose.rotation.x=Math.PI/2; nose.position.set(0,0.28,1.8); nose.castShadow=true; g.add(nose);
  const noseTip=new THREE.Mesh(new THREE.ConeGeometry(0.08,0.3,6),carbon);
  noseTip.rotation.x=Math.PI/2; noseTip.position.set(0,0.28,2.2); g.add(noseTip);

  // === 驾驶舱 ===
  const cock=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.2,0.6),dark);
  cock.position.set(0,0.46,-0.1); g.add(cock);
  // 车手肩膀/身体 (简化)
  const driverBody=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.12,0.22),body);
  driverBody.position.set(0,0.48,-0.05); g.add(driverBody);
  // 头盔 (车队配色)
  const helmetMat=new THREE.MeshStandardMaterial({color:team?team.color:0xffffff, metalness:0.3, roughness:0.4});
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(0.12,10,8),helmetMat);
  helmet.position.set(0,0.57,0.02); g.add(helmet);
  // 面罩 (Visor)
  const visor=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.07,0.06),
    new THREE.MeshStandardMaterial({color:0x111111, metalness:0.9, roughness:0.1}));
  visor.position.set(0,0.56,0.11); g.add(visor);

  // === Halo ===
  const halo=new THREE.Mesh(new THREE.TorusGeometry(0.24,0.025,8,16,Math.PI),dark);
  halo.rotation.x=-Math.PI/2; halo.position.set(0,0.60,0.12); g.add(halo);
  const haloBar=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.48,6),dark);
  haloBar.rotation.x=Math.PI/2; haloBar.position.set(0,0.60,0.36); g.add(haloBar);

  // === 后视镜 ===
  const mirrorMat=new THREE.MeshStandardMaterial({color:0xcccccc, metalness:0.9, roughness:0.1});
  const mirrorL=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.04,0.03),mirrorMat);
  mirrorL.position.set(0.32,0.44,0.3); g.add(mirrorL);
  const mirrorR=mirrorL.clone(); mirrorR.position.x=-0.32; g.add(mirrorR);
  // 后视镜支架
  const stalkL=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.015,0.015),carbon);
  stalkL.position.set(0.24,0.44,0.3); g.add(stalkL);
  const stalkR=stalkL.clone(); stalkR.position.x=-0.24; g.add(stalkR);

  // === 前翼 (多元素) ===
  const fWingMain=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.03,0.25),carbon);
  fWingMain.position.set(0,0.18,2.1); fWingMain.castShadow=true; g.add(fWingMain);
  const fWingFlap=new THREE.Mesh(new THREE.BoxGeometry(1.15,0.02,0.15),carbon);
  fWingFlap.position.set(0,0.22,2.05); g.add(fWingFlap);
  // 端板
  const fEnd=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.16,0.35),carbon);
  fEnd.position.set(0.6,0.24,2.05); g.add(fEnd);
  const fEnd2=fEnd.clone(); fEnd2.position.x=-0.6; g.add(fEnd2);

  // === 后翼 (带DRS) ===
  const rWingMain=new THREE.Mesh(new THREE.BoxGeometry(0.95,0.04,0.28),carbon);
  rWingMain.position.set(0,0.68,-1.35); rWingMain.castShadow=true; g.add(rWingMain);
  const rWingFlap=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.03,0.18),carbon);
  rWingFlap.position.set(0,0.72,-1.32); g.add(rWingFlap);
  // 支柱
  const rStrut=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.42,0.05),carbon);
  rStrut.position.set(0,0.47,-1.33); g.add(rStrut);
  // 端板
  const rEnd=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.18,0.4),carbon);
  rEnd.position.set(0.48,0.68,-1.35); g.add(rEnd);
  const rEnd2=rEnd.clone(); rEnd2.position.x=-0.48; g.add(rEnd2);

  // === 进气口 (airbox above driver) ===
  const airbox=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.24,0.3),dark);
  airbox.position.set(0,0.64,-0.42); g.add(airbox);
  const airboxTop=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.04,0.26),dark);
  airboxTop.position.set(0,0.76,-0.42); g.add(airboxTop);

  // === T-Cam (摄像头, FIA强制) ===
  const tcam=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.06),
    new THREE.MeshStandardMaterial({color:0xff2200, emissive:0xff2200, emissiveIntensity:0.8}));
  tcam.position.set(0,0.80,-0.42); g.add(tcam);
  const tcamPillar=new THREE.Mesh(new THREE.CylinderGeometry(0.01,0.01,0.06,4),dark);
  tcamPillar.position.set(0,0.77,-0.42); g.add(tcamPillar);

  // === 排气管 ===
  const exhaust=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.06,0.15,8),
    new THREE.MeshStandardMaterial({color:0x444444, metalness:0.9, roughness:0.3}));
  exhaust.rotation.x=Math.PI/2; exhaust.position.set(0,0.35,-1.55); g.add(exhaust);
  // 排气管内发光
  const exhaustGlow=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.02,8),
    new THREE.MeshStandardMaterial({color:0xff4400, emissive:0xff4400, emissiveIntensity:1.5}));
  exhaustGlow.rotation.x=Math.PI/2; exhaustGlow.position.set(0,0.35,-1.62); g.add(exhaustGlow);

  // === 刹车导管 (前轮) ===
  const brakeDuctF=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.06),carbon);
  brakeDuctF.position.set(0.48,0.33,1.15); g.add(brakeDuctF);
  const brakeDuctF2=brakeDuctF.clone(); brakeDuctF2.position.x=-0.48; g.add(brakeDuctF2);
  // === 刹车导管 (后轮) ===
  const brakeDuctR=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.10,0.05),carbon);
  brakeDuctR.position.set(0.52,0.33,-0.95); g.add(brakeDuctR);
  const brakeDuctR2=brakeDuctR.clone(); brakeDuctR2.position.x=-0.52; g.add(brakeDuctR2);

  // === 底板边缘 (floor edge) ===
  const floorEdge=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.02,2.0),carbon);
  floorEdge.position.set(0,0.14,0.1); g.add(floorEdge);
  // 扩散器 (diffuser)
  const diffuser=new THREE.Mesh(new THREE.BoxGeometry(1.0,0.15,0.3),carbon);
  diffuser.position.set(0,0.20,-1.45); diffuser.rotation.x=-0.15; g.add(diffuser);

  // === 尾灯 (夜赛) ===
  const tailLight=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.05,0.03),
    new THREE.MeshStandardMaterial({color:0xff0000,emissive:0xff0000,emissiveIntensity:3.0}));
  tailLight.position.set(0,0.52,-1.5); g.add(tailLight);
  // 雨灯 (F1标配)
  const rainLight=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.04,0.03),
    new THREE.MeshStandardMaterial({color:0xff3300,emissive:0xff3300,emissiveIntensity:2.0}));
  rainLight.position.set(0,0.48,-1.5); g.add(rainLight);

  // === 车轮 (带轮毂 + 轮辐细节) ===
  const wheelGeo=new THREE.CylinderGeometry(0.33,0.33,0.26,18);
  const rimGeo=new THREE.CylinderGeometry(0.20,0.20,0.27,12);
  const hubGeo=new THREE.CylinderGeometry(0.06,0.06,0.28,6); // 中心螺母
  const spokeGeo=new THREE.BoxGeometry(0.02,0.28,0.02);
  const rims=[];
  const allWheels=[];
  [[0.48,1.05],[0.52,-1.05]].forEach(([x,z])=>{
    // 左轮
    const w=new THREE.Mesh(wheelGeo,tire); w.rotation.z=Math.PI/2; w.position.set(x,0.33,z); w.castShadow=true; g.add(w);
    allWheels.push(w);
    const rim=new THREE.Mesh(rimGeo,rimMat); rim.rotation.z=Math.PI/2; rim.position.set(x,0.33,z); g.add(rim);
    const hub=new THREE.Mesh(hubGeo,new THREE.MeshStandardMaterial({color:0x333333,metalness:0.9,roughness:0.2}));
    hub.rotation.z=Math.PI/2; hub.position.set(x,0.33,z); g.add(hub);
    // 轮辐 (5根)
    for(let s=0;s<5;s++){
      const spoke=new THREE.Mesh(spokeGeo,rimMat);
      const ang=s*Math.PI*2/5;
      spoke.position.set(x,0.33+Math.sin(ang)*0.12,z+Math.cos(ang)*0.12);
      spoke.rotation.z=Math.PI/2; spoke.rotation.x=ang;
      g.add(spoke);
    }
    if(z>0) rims.push(w);
    // 右轮
    const w2=new THREE.Mesh(wheelGeo,tire); w2.rotation.z=Math.PI/2; w2.position.set(-x,0.33,z); w2.castShadow=true; g.add(w2);
    allWheels.push(w2);
    const rim2=new THREE.Mesh(rimGeo,rimMat); rim2.rotation.z=Math.PI/2; rim2.position.set(-x,0.33,z); g.add(rim2);
    const hub2=hub.clone(); hub2.position.set(-x,0.33,z); g.add(hub2);
    if(z>0) rims.push(w2);
  });
  g.userData.frontWheels=rims;

  // === 车头大灯 ===
  const headlightMat=new THREE.MeshStandardMaterial({
    color:0xffffee, emissive:0xffffcc, emissiveIntensity:1.2, roughness:0.3, metalness:0.1
  });
  const hlGeo=new THREE.BoxGeometry(0.3,0.15,0.1);
  const hlL=new THREE.Mesh(hlGeo, headlightMat);
  hlL.position.set(0.5, 0.45, 2.4);
  g.add(hlL);
  const hlR=new THREE.Mesh(hlGeo, headlightMat);
  hlR.position.set(-0.5, 0.45, 2.4);
  g.add(hlR);

  // === 尾灯 ===
  const tailLightMat=new THREE.MeshStandardMaterial({
    color:0xff2222, emissive:0xff0000, emissiveIntensity:0.8, roughness:0.5
  });
  const tlGeo=new THREE.BoxGeometry(0.25,0.1,0.08);
  const tlL=new THREE.Mesh(tlGeo, tailLightMat);
  tlL.position.set(0.55, 0.5, -2.3);
  g.add(tlL);
  const tlR=new THREE.Mesh(tlGeo, tailLightMat);
  tlR.position.set(-0.55, 0.5, -2.3);
  g.add(tlR);

  // 玩家车添加聚光灯 (真实照亮前方)
  if(isPlayer){
    const spot=new THREE.SpotLight(0xffffee, 1.2, 60, Math.PI/5, 0.4, 1);
    spot.position.set(0, 0.6, 2.2);
    spot.target.position.set(0, 0, 25);
    g.add(spot);
    g.add(spot.target);
    g.userData.headlight=spot;
  }

  // 存储材质引用 (用于车库颜色切换)
  g.userData.bodyMat = body;
  g.userData.helmetMat = helmetMat;
  g.userData.sidepodMat = sidepodMat; // 侧箱材质 (带车队纹理)
  g.userData.wheelRings = allWheels; // 全部4个车轮 Mesh (共享 tire 材质)

  // 真实 F1 比例: 车长 ~5.85m, 宽 ~1.86m (与 CAR_CORNERS/Physics2D 碰撞盒一致)
  g.scale.setScalar(1.5);

  return g;
}

let totalLaps = 5; // 可由 startRace(config.laps) 修改

// ============================================================
//  维修站 (Pit Building) — 维修通道南侧 (必须在 TEAMS 之后)
//  布局: 建筑(z=300) → 玻璃幕墙(z=306) → 维修位(z=315) → 通道(z=318) → 内墙(z=323) → 赛道(z=340)
// ============================================================
(()=>{
  const pitGrp=new THREE.Group();
  const wallMat=new THREE.MeshStandardMaterial({color:0x2a2a3e, roughness:0.7, metalness:0.3});
  const glassMat=new THREE.MeshStandardMaterial({color:0x88aacc, transparent:true, opacity:0.4, metalness:0.8, roughness:0.2});
  const roofMat=new THREE.MeshStandardMaterial({color:0x1a1a2a, roughness:0.6, metalness:0.4});
  const floorMat=new THREE.MeshStandardMaterial({color:0x333340, roughness:0.8});

  // 主建筑 (长条, 位于维修通道南侧)
  const building=new THREE.Mesh(new THREE.BoxGeometry(80, 8, 12), wallMat);
  building.position.set(-200, 4, 300);
  building.castShadow=false; building.receiveShadow=true;
  pitGrp.add(building);
  // 玻璃幕墙 (面向维修通道=北侧)
  const glass=new THREE.Mesh(new THREE.BoxGeometry(78, 6, 0.2), glassMat);
  glass.position.set(-200, 4, 306);
  pitGrp.add(glass);
  // 屋顶
  const roof=new THREE.Mesh(new THREE.BoxGeometry(82, 0.5, 14), roofMat);
  roof.position.set(-200, 8.25, 300);
  roof.castShadow=false;
  pitGrp.add(roof);
  // 维修间分隔 (每个车队一个, 在建筑内)
  for(let i=0;i<NCARS;i++){
    const divider=new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 11), wallMat);
    const dx = -236+i*(640/NCARS); // 均匀分布
    divider.position.set(dx, 4, 300);
    pitGrp.add(divider);
    // 车队颜色标记 (顶部, 在玻璃幕墙上)
    const team=TEAMS[i%TEAMS.length];
    const colorBar=new THREE.Mesh(
      new THREE.BoxGeometry(7.5, 0.3, 0.5),
      new THREE.MeshStandardMaterial({color:team.color, emissive:team.color, emissiveIntensity:0.5})
    );
    colorBar.position.set(dx+4, 8, 306);
    pitGrp.add(colorBar);
    // 车队名称标牌 (在维修位上方墙上)
    const nameCanvas=document.createElement('canvas');
    nameCanvas.width=128; nameCanvas.height=32;
    const nctx=nameCanvas.getContext('2d');
    nctx.fillStyle='#'+team.color.toString(16).padStart(6,'0');
    nctx.fillRect(0,0,128,32);
    nctx.fillStyle='#ffffff';
    nctx.font='bold 20px sans-serif'; nctx.textAlign='center';
    nctx.fillText(team.name||('T'+(i+1)), 64, 22);
    const nameTex=new THREE.CanvasTexture(nameCanvas);
    const namePlane=new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.2),
      new THREE.MeshBasicMaterial({map:nameTex, transparent:true})
    );
    namePlane.position.set(dx+4, 5.5, 306.1);
    pitGrp.add(namePlane);
  }
  // 维修站地面 (建筑前方, 延伸到维修通道停车区 z=315~320)
  const pitFloor=new THREE.Mesh(new THREE.BoxGeometry(80, 0.1, 10), floorMat);
  pitFloor.position.set(-200, 0.05, 315);
  pitFloor.receiveShadow=true;
  pitGrp.add(pitFloor);
  // "PIT" 标识 (建筑顶部)
  const pitSign=new THREE.Mesh(
    new THREE.BoxGeometry(6, 1.5, 0.2),
    new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xffffff, emissiveIntensity:1.0})
  );
  pitSign.position.set(-200, 9, 306);
  pitGrp.add(pitSign);

  // === Pit Wall (赛道与维修通道之间的隔离墙) ===
  const pitWallMat=new THREE.MeshStandardMaterial({color:0x1a1a2e, roughness:0.5, metalness:0.4});
  const pitWall=new THREE.Mesh(new THREE.BoxGeometry(80, 1.5, 0.4), pitWallMat);
  pitWall.position.set(-200, 0.75, 324);
  pitWall.receiveShadow=true;
  pitGrp.add(pitWall);
  // Pit Wall 顶部车队颜色条
  for(let i=0;i<NCARS;i++){
    const team=TEAMS[i%TEAMS.length];
    const wallBar=new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.2, 0.5),
      new THREE.MeshStandardMaterial({color:team.color, emissive:team.color, emissiveIntensity:0.6})
    );
    wallBar.position.set(-236+i*(640/NCARS), 1.5, 324);
    pitGrp.add(wallBar);
  }

  // === overhead gantry (龙门架, 横跨维修通道) ===
  const gantryMat=new THREE.MeshStandardMaterial({color:0x3a3a4e, metalness:0.6, roughness:0.4});
  const pillarGeo=new THREE.BoxGeometry(0.6, 10, 0.6);
  const pillarL=new THREE.Mesh(pillarGeo, gantryMat);
  pillarL.position.set(-240, 5, 312); pillarL.castShadow=true; pitGrp.add(pillarL);
  const pillarR=new THREE.Mesh(pillarGeo, gantryMat);
  pillarR.position.set(-160, 5, 312); pillarR.castShadow=true; pitGrp.add(pillarR);
  const beam=new THREE.Mesh(new THREE.BoxGeometry(82, 0.8, 1.5), gantryMat);
  beam.position.set(-200, 10.5, 312); beam.castShadow=true; pitGrp.add(beam);
  const screenMat=new THREE.MeshStandardMaterial({color:0x001122, emissive:0x003366, emissiveIntensity:0.8});
  const screen1=new THREE.Mesh(new THREE.BoxGeometry(12, 2, 0.15), screenMat);
  screen1.position.set(-200, 10.5, 311.2); pitGrp.add(screen1);
  const screenGlow=new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 0.1),
    new THREE.MeshStandardMaterial({color:0x00e5ff, emissive:0x00e5ff, emissiveIntensity:1.5}));
  screenGlow.position.set(-200, 10.5, 311.1); pitGrp.add(screenGlow);

  // === 轮胎堆 (放在维修位旁) ===
  const tireStackMat=new THREE.MeshStandardMaterial({color:0x1a1a1c, roughness:0.95});
  for(let i=0;i<4;i++){
    const stack=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,0.15*3,12), tireStackMat);
    stack.position.set(-230+i*18, 0.25, 312);
    stack.rotation.z=Math.PI/2;
    pitGrp.add(stack);
  }

  // === 工具柜 (建筑内, 靠后墙) ===
  const equipMat=new THREE.MeshStandardMaterial({color:0x444455, metalness:0.5, roughness:0.5});
  for(let i=0;i<8;i++){
    const cabinet=new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.8, 0.8), equipMat);
    cabinet.position.set(-232+i*9.5, 0.9, 295);
    pitGrp.add(cabinet);
  }

  // === 地面标线 (引导线, 在维修位区域) ===
  const pitLineMat=new THREE.MeshStandardMaterial({color:0xffffff, emissive:0x888888, emissiveIntensity:0.3});
  for(let i=0;i<12;i++){
    const pitLine=new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 12), pitLineMat);
    pitLine.position.set(-236+i*7, 0.06, 312);
    pitGrp.add(pitLine);
  }

  // === 千斤顶 (放在维修位前方) ===
  const jackMat=new THREE.MeshStandardMaterial({color:0xcc3300, metalness:0.6, roughness:0.4});
  for(let i=0;i<5;i++){
    const jack=new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), jackMat);
    jack.position.set(-225+i*12, 0.25, 314);
    pitGrp.add(jack);
  }

  // === 维修位遮阳棚 (覆盖停车区 z=315~320) ===
  const canopyMat=new THREE.MeshStandardMaterial({color:0x1a1a2a, roughness:0.7, metalness:0.2, side:THREE.DoubleSide});
  const canopy=new THREE.Mesh(new THREE.BoxGeometry(80, 0.3, 8), canopyMat);
  canopy.position.set(-200, 7.5, 317);
  canopy.castShadow=true;
  pitGrp.add(canopy);

  scene.add(pitGrp);
})();

// 车身纹理 (车队名 + 车手号)
function makeCarTexture(team, isPlayer){
  const c=document.createElement('canvas'); c.width=256; c.height=64;
  const x=c.getContext('2d');
  // 背景渐变 (车队主色)
  const hex='#'+team.color.toString(16).padStart(6,'0');
  const accentHex='#'+team.accent.toString(16).padStart(6,'0');
  const grad=x.createLinearGradient(0,0,0,64);
  grad.addColorStop(0, hex); grad.addColorStop(1, accentHex);
  x.fillStyle=grad; x.fillRect(0,0,256,64);
  // 车队简称 (大字)
  x.fillStyle=isPlayer?'#00ffff':'#ffffff';
  x.font='bold 28px Arial'; x.textAlign='center';
  x.fillText(team.short, 128, 30);
  // 车手号
  x.fillStyle='#ffffff'; x.font='bold 36px Arial';
  x.fillText('#'+team.num, 128, 62);
  // 车手名缩写 (左上角)
  x.font='bold 14px Arial'; x.textAlign='left';
  x.fillText(team.driver, 8, 18);
  // 玩家标记
  if(isPlayer){
    x.fillStyle='#00ffff'; x.font='bold 10px Arial'; x.textAlign='right';
    x.fillText('YOU', 248, 18);
  }
  return c;
}

function makeCar(isPlayer, gridSlot){
  const team=TEAMS[gridSlot%TEAMS.length];
  const mesh=buildF1Car(team.color, team, isPlayer);
  scene.add(mesh);
  // 对手标记 (光圈 + 光柱) — 仅在AI车辆上方显示
  let marker=null;
  if(!isPlayer){
    // 主标记环
    const markerGeo=new THREE.RingGeometry(0.7, 0.9, 20);
    const markerMat=new THREE.MeshBasicMaterial({
      color:team.color, transparent:true, opacity:0.8, side:THREE.DoubleSide
    });
    marker=new THREE.Mesh(markerGeo, markerMat);
    marker.rotation.x=-Math.PI/2;
    marker.position.y=3.0;
    mesh.add(marker);
    // 外圈发光
    const glowGeo=new THREE.RingGeometry(0.5, 1.1, 20);
    const glowMat=new THREE.MeshBasicMaterial({
      color:team.color, transparent:true, opacity:0.3, side:THREE.DoubleSide
    });
    const glow=new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x=-Math.PI/2;
    glow.position.y=3.0;
    mesh.add(glow);
    marker.userData.glow=glow;
    // 垂直光柱 (从车顶向上延伸)
    const beamGeo=new THREE.CylinderGeometry(0.08, 0.25, 6, 8, 1, true);
    const beamMat=new THREE.MeshBasicMaterial({
      color:team.color, transparent:true, opacity:0.2, side:THREE.DoubleSide
    });
    const beam=new THREE.Mesh(beamGeo, beamMat);
    beam.position.y=6.0;
    mesh.add(beam);
    marker.userData.beam=beam;
    // 向下箭头指示 (锥形)
    const arrowGeo=new THREE.ConeGeometry(0.2, 0.4, 6);
    const arrowMat=new THREE.MeshBasicMaterial({
      color:team.color, transparent:true, opacity:0.6
    });
    const arrow=new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x=Math.PI; // 朝下
    arrow.position.y=2.3;
    mesh.add(arrow);
    marker.userData.arrow=arrow;
  }
  // 发车位: pit 直道东行, 玩家在中间
  const gx = -300 + gridSlot*20;
  const gz = 340 + (gridSlot%2)*4 - 2;
  return {
    mesh, marker, isPlayer, team,
    name:team.driver, num:team.num, teamName:team.name,
    pos:new THREE.Vector3(gx,0,gz),
    heading:Math.PI/2,
    speed:0,
    velocity:new THREE.Vector3(),
    maxSpeed: isPlayer?82:(difficulty==='easy'?rand(72,78):difficulty==='hard'?rand(82,90):rand(78,86)),
    accel: isPlayer?42:50,
    turnRate: isPlayer?2.2:3.0, // F1 手感: 转向速率 2.2 (报告目标值)
    sampleIdx:0, progress:0, lap:0,
    tire:100, tireCompound: isPlayer?'S':'M',
    // 轮胎系统: 类型/磨损/寿命
    tireType: isPlayer?'soft':'hard', // soft=激进, hard=稳健
    tireWearLaps: 0,                   // 已使用圈数
    tireMaxLaps: isPlayer?3:4,         // 最大寿命圈数 (soft=2-3, hard=3-5)
    tireDegraded: false,               // 是否已衰减
    tireBlowoutTriggered: false,       // 爆胎特效是否已触发
    tireSparkTimer: 0,                 // 轻微火花计时器
    tireSpeedMult: 1.0,                // 速度乘数
    tireGripMult: 1.0,                 // 抓地力乘数
    // NPC 进站策略: aggressive(激进)/balanced(均衡)/conservative(保守)
    pitStrategy: isPlayer ? null : (Math.random()<0.3 ? 'aggressive' : Math.random()<0.57 ? 'balanced' : 'conservative'),
    pitStopDuration: isPlayer ? 0 : (Math.random()<0.3 ? 3.0 : Math.random()<0.57 ? 4.5 : 6.0), // 进站时长
    ers:100, fuel:100,
    drsActive:false, drsAvailable:false,
    gear:1, rpm:0,
    sectorTimes:[null,null,null], bestSector:[null,null,null],
    lastSectorTimes:[null,null,null], lastLapTime:null,
    curSectorStart:0, lapStartTime:0, bestLap:null,
    finished:false, finishTime:0, pits:0,
    aiTarget:0, aiSkill: difficulty==='easy' ? rand(0.88,0.96) : difficulty==='hard' ? rand(1.0,1.12) : rand(0.94,1.08),
    // 走线属性: 0=极端内侧, 1=极端外侧, 影响过弯走线偏好
    racingLineBias: rand(0.15, 0.85),
    // 走线精度: 0=很差(大变量), 1=完美
    linePrecision: rand(0.65, 0.95),
    // 恢复模式: 撞墙后回到走线
    recoveryMode:false, recoveryTimer:0,
    offTrack:false, jumpStart:false,
    pitTimer:0, holdTimer:0,
    // NPC 进站状态机: pitting=true时进入维修通道流程
    pitting: false,                  // 是否正在进站
    pitPhase: null,                  // 'entering'|'driving'|'stopped'|'exiting'
    pitBoxIdx: isPlayer ? 0 : Math.floor(Math.random() * NCARS), // 分配的维修位索引 (会在startRace中去重)
    crashTimer:0, crashAngle:0,
    inReverse:false, reverseTimer:0, // 倒车状态
    // 碰撞锁定: >0时挂起正常速度重建, 让碰撞响应真正生效
    collisionLock:0,
    collisionVel:new THREE.Vector3(),
    collisionSpin:0,
    angularVel:0, // 角速度 (偏航旋转, 物理引擎用)
    _lastHit:false,
    // 碰撞冷却: 防止反复碰撞 (秒)
    collisionCooldown:0,
    // AI 低频噪声 (替代每帧random, 避免车头摇摆)
    noisePhase:Math.random()*7, noiseVal:0, noiseTimer:0, noiseTarget:0,
  };
}
function rand(a,b){return a+Math.random()*(b-a);}

let cars=[];
let player=null;

const _tmp=new THREE.Vector3();
// nearestSample / nearestSegment 已在城市建筑段之前定义

// ============================================================
//  底层物理引擎: 已迁移至 assets/physics2d.js (Physics2D)
//  2D 刚体冲量求解 (含偏航力矩), 参数参考真实 F1 赛车数据
// ============================================================

// ============================================================
//  围栏硬碰撞 (边界框 + 冲量物理引擎 + 子步防穿模)
// ============================================================
// 赛车边界框角点 (局部坐标, x=横向, z=纵向, +z=车头方向)
// 与放大 1.5x 后的车模一致 (真实 F1 比例: 长 ~5.9m, 宽 ~1.86m)
// 前翼宽 1.86m → x=±0.93; 车头 z=3.38; 车尾 z=-2.48; 侧箱 x=±0.87
const CAR_CORNERS = [
  {x:-0.93, z:3.38},  // 前左 (前翼端板)
  {x: 0.93, z:3.38},  // 前右
  {x:-0.87, z:-2.48}, // 后左 (后翼端板)
  {x: 0.87, z:-2.48}, // 后右
  {x:-0.93, z:0.15},  // 中左 (侧箱)
  {x: 0.93, z:0.15},  // 中右
];

// 计算车辆角点的世界坐标 (返回 Vector3, 带 _lastSampleIdx 优化提示)
function getCarCorners(c){
  const cos=Math.cos(c.heading), sin=Math.sin(c.heading);
  const baseIdx = c.sampleIdx || 0;
  const result=[];
  for(const p of CAR_CORNERS){
    const v = new THREE.Vector3(
      c.pos.x + p.x * cos + p.z * sin,
      0,
      c.pos.z - p.x * sin + p.z * cos
    );
    v._lastSampleIdx = baseIdx;
    v._localX = p.x; // 保存局部x, 用于偏航力矩计算
    result.push(v);
  }
  return result;
}

function barrierCollision(c){
  let hit=false;
  let seg = nearestSegment(c.pos);
  c.sampleIdx = seg.i;

  // 在维修通道内或正在进站时, 不执行赛道围栏碰撞 (允许车辆驶入维修区)
  if(c.pitting || isInPitLane(c.pos)){
    c._lastHit = false;
    c.offTrack = false;
    return { seg, hit: false };
  }

  // === 边界框碰撞: 检查全部角点 + 中心 ===
  let maxOvershoot = 0;
  let pushSign = 0;
  let pushNormal = null;
  let collisionPoint = null;

  // 中心点检查
  if(seg.absLat > WALL_DIST){
    const overshoot = seg.absLat - WALL_DIST;
    if(overshoot > maxOvershoot){
      maxOvershoot = overshoot;
      pushSign = Math.sign(seg.lateral);
      pushNormal = seg.normal;
      collisionPoint = c.pos.clone();
    }
  }

  // 角点检查
  const corners = getCarCorners(c);
  for(const corner of corners){
    const cornerSeg = nearestSegment(corner);
    if(cornerSeg.absLat > WALL_DIST){
      const overshoot = cornerSeg.absLat - WALL_DIST;
      if(overshoot > maxOvershoot){
        maxOvershoot = overshoot;
        pushSign = Math.sign(cornerSeg.lateral);
        pushNormal = cornerSeg.normal;
        collisionPoint = corner.clone(); collisionPoint.y = 0.3;
      }
    }
  }

  if(maxOvershoot > 0){
    hit = true;
    // 墙法线: 指向赛道内侧 (即把车推回赛道的方向)
    const nx = -pushSign * pushNormal.x, nz = -pushSign * pushNormal.z;

    // === 物理引擎: 单点接触冲量 (Physics2D, 含偏航力矩) ===
    const res = Physics2D.wallResolve(c, collisionPoint.x, collisionPoint.z, nx, nz, maxOvershoot);

    // 二次验证: 残留穿透直接位置推出 (速度已由冲量求解)
    for(let iter=0; iter<3; iter++){
      let reOV=0, reN=null, reS=0;
      const reCorners = getCarCorners(c);
      for(const corner of reCorners){
        const cs = nearestSegment(corner);
        if(cs.absLat > WALL_DIST){
          const ov = cs.absLat - WALL_DIST;
          if(ov > reOV){ reOV=ov; reN=cs.normal; reS=Math.sign(cs.lateral); }
        }
      }
      const csC = nearestSegment(c.pos);
      if(csC.absLat > WALL_DIST){
        const ov = csC.absLat - WALL_DIST;
        if(ov > reOV){ reOV=ov; reN=csC.normal; reS=Math.sign(csC.lateral); }
      }
      if(reOV <= 0) break;
      c.pos.addScaledVector(reN, -reS * (reOV * 0.5 + 0.02));
    }

    // 撞击烈度: 法向接近速度 (真实物理量, 沿墙刮擦不再误判为重撞)
    const impact = res ? Math.abs(res.vn) : 0;

    // speed 同步: 速度在车头方向的投影 (带符号, 允许横滑)
    {
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      c.speed = c.velocity.x*fx + c.velocity.z*fz;
    }

    // collisionLock: 法向重撞时让反弹速度真正积分
    if(impact > 12){
      c.collisionLock = 0.06 + Math.min(0.08, impact * 0.0012);
      c.collisionVel.copy(c.velocity);
      c.collisionSpin = c.angularVel || 0;
    } else {
      c.collisionLock = 0;
    }

    // 特效 (按法向撞击速度分级)
    const sparkPos = collisionPoint || c.pos;
    if(impact > 22 && c.crashTimer <= 0){
      c.crashTimer = 0.3;
      // 翻滚方向跟随求解出的偏航方向
      c.crashAngle = (Math.sign(c.angularVel)||(Math.random()>0.5?1:-1))*(0.2+Math.random()*0.2);
      if(c.isPlayer){ flashMsg('CRASH!','碰撞 · '+(impact*3.6|0)+'km/h'); camShake=Math.min(1.0, impact/40); playCrashSound(1.0); }
      else if(impact>35) playCrashSound(0.5);
      spawnSparks(sparkPos, Math.min(15, Math.floor(impact/2)));
    } else if(impact > 9 && c.crashTimer <= 0){
      if(c.isPlayer){ camShake=Math.max(camShake, impact/60); flashMsg('TOUCH','擦碰'); playCrashSound(0.3); }
      spawnSparks(sparkPos, 5);
    } else if(impact > 2.5){
      spawnSparks(sparkPos, 2);
    }
    // 刮擦/撞击消耗轮胎: 烈度越大损耗越多
    const tireHit = impact > 20 ? 6 : impact > 8 ? 3 : impact > 2.5 ? 1 : 0;
    c.tire = Math.max(0, c.tire - tireHit);
    // 悬挂冲击: 车身向下"砸"一下再回弹 (重力感)
    if(c._sus && impact > 4) c._sus.yV = Math.min(c._sus.yV, -impact * 0.02);
  }

  c._lastHit = hit;
  c.offTrack = seg.absLat > HALF_W + 0.2;
  if(c.offTrack && !hit && c.crashTimer <= 0){ c.speed *= 0.97; }
  return { seg, hit };
}

// ============================================================
//  玩家物理 (街机式 + 围栏碰撞)
// ============================================================
const input={acc:false,brake:false,steer:0,steerLeft:false,steerRight:false,ers:false,drs:false,pit:false};
function updatePlayer(dt){
  const c=player;
  // 进站小游戏期间: 锁定车辆, 不可驾驶
  if(pitGame && pitGame.active){
    c.speed=0; c.velocity.set(0,0,0); c.angularVel=0;
    applyMesh(c); return;
  }
  // 注意: 碰撞后不再冻结车辆 (真实世界: 车带剩余动量继续滑行/打转),
  // crashTimer 仅为视觉翻滚动画, 在 loop 中统一计时
  // 碰撞锁定: 挂起正常速度重建, 让反弹真正积分
  if(c.collisionLock > 0){
    c.collisionLock -= dt;
    // 安全衰减: 确保系数为正
    const decay = Math.max(0.5, 1 - 1.0*dt);
    c.collisionVel.multiplyScalar(decay);
    // 限制碰撞速度幅值, 防止飞出
    const cvLen = c.collisionVel.length();
    if(cvLen > 40) c.collisionVel.multiplyScalar(40/cvLen);
    c.velocity.copy(c.collisionVel);
    // 同步 speed, 防止退出 collisionLock 后速度跳变 (保留方向)
    c.speed = c.velocity.length() * (c.speed >= 0 ? 1 : -1);
    // collisionSpin 衰减 (防止长期累积导致异常旋转)
    c.collisionSpin *= Math.max(0, 1 - 3.0*dt);
    c.heading += c.collisionSpin * dt * 0.5;
    // 玩家锁内仍可微调转向 (保留操控感)
    const steerTarget = (input.steerLeft?1:0) - (input.steerRight?1:0);
    c.heading += steerTarget * c.turnRate * 0.3 * dt;
    c.pos.addScaledVector(c.velocity, dt);
    // NaN保护
    if(isNaN(c.pos.x)||isNaN(c.pos.z)){
      resetPlayerToTrack();
      c.collisionLock = 0;
      return;
    }
    barrierCollision(c);
    applyMesh(c);
    updateProgress(c, dt);
    return;
  }
  // 碰撞冷却期: 防止反复碰撞
  if(c.collisionCooldown > 0){
    c.collisionCooldown -= dt;
  }
  if(race.phase==='menu'||race.phase==='paused'||race.phase==='over'){ c.speed*=0.9; }
  if(c.holdTimer>0){
    c.holdTimer-=dt; c.speed=0;
    if(c.holdTimer<=0 && race.phase==='racing') flashMsg('GO!','罚时结束');
  } else if(c.pitTimer>0){
    c.pitTimer-=dt;
    c.speed*=0.92;
    if(c.pitTimer<=0){
      c.tire=100; c.tireCompound='S';
      c.tireWearLaps=0; c.tireDegraded=false; c.tireSpeedMult=1.0; c.tireGripMult=1.0;
      flashMsg('PIT DONE','新胎 · 软胎');
    }
  } else {
    // ===== 真实物理: 非线性加速 + 空气阻力 + 速度制动 =====
    const v=c.speed;
    const vtop=c.maxSpeed;
    // 轮胎抓地: 基础值 + 视觉磨损 + 类型加成 + 衰减乘数
    const baseTireGrip = 0.55 + 0.45*(c.tire/100);
    const typeGripBonus = c.tireType==='soft' ? 1.15 : 1.0; // Soft +15% 抓地
    const tireGrip = baseTireGrip * typeGripBonus * c.tireGripMult;

    if(input.acc && (race.phase==='racing'||race.phase==='grid')){
      // 非线性加速: a = a0*(1-(v/vtop)^0.5) - drag*v²
      // 低速: 牵引力限制(高加速), 中高速仍有强加速, 极速: 阻力=驱动力
      const driveAccel = c.accel * (1 - Math.pow(v/vtop, 0.5));
      const dragForce = 0.0009 * v * v;  // 空气阻力 ∝ v²
      c.speed += (driveAccel * tireGrip - dragForce) * dt;
    } else if(input.brake){
      // 制动: 主要由轮胎抓地力决定, 下压力提供有限增益
      // 基础制动力较强, 高速下压力增益不超过40%
      const baseBrake = 32;  // 基础制动力
      const downforceBrake = 0.0025 * v * v;  // 下压力增益 (80m/s时+16)
      const brakeForce = Math.min(baseBrake + downforceBrake, 48);  // 上限48
      c.speed -= brakeForce * tireGrip * dt;
    } else {
      // 滑行阻力 (引擎制动 + 滚动阻力)
      c.speed -= (4 + 0.0003*v*v) * dt;
    }
  }
  // ERS 部署 (功率叠加) — 爆胎时效果减半 (与AI一致)
  let ersBoost=0;
  const playerErsFactor = c.tire <= 0 ? 0.5 : 1.0;
  if(input.ers && c.ers>1 && race.phase==='racing'){ ersBoost=14*playerErsFactor; c.ers=Math.max(0,c.ers-22*dt); }
  else { c.ers=Math.min(100,c.ers+ (input.brake?26:6)*dt); }
  // DRS (降阻提速)
  c.drsActive=false;
  if(c.drsAvailable && input.drs && !input.brake && c.speed>40){ c.drsActive=true; }
  const drsBoost = c.drsActive?9:0;
  // 尾流
  let tow=0;
  for(const o of cars){ if(o===c)continue;
    const dx=o.pos.x-c.pos.x, dz=o.pos.z-c.pos.z;
    const dist=Math.hypot(dx,dz);
    if(dist>6 && dist<34){
      const fwd={x:Math.sin(c.heading),z:Math.cos(c.heading)};
      const dot=(dx*fwd.x+dz*fwd.z)/dist;
      if(dot>0.85) tow=Math.max(tow, (34-dist)/34*7);
    }
  }
  // 倒车逻辑 (仅玩家, 比赛中): 静止时按住刹车 0.5秒切换倒车模式
  if(c.isPlayer && !c.isAI && race.phase==='racing'){
    // 进入倒车模式: 车辆接近静止 + 持续按刹车
    if(Math.abs(c.speed) < 2 && input.brake && !input.acc){
      c.reverseTimer = (c.reverseTimer||0) + dt;
      if(c.reverseTimer > 0.5 && !c.inReverse){
        c.inReverse = true;
        flashMsg('REVERSE','倒车模式');
      }
    } else if(!c.inReverse){
      // 松开刹车/给油即清零, 防止多次点刹累积误入倒车
      c.reverseTimer = 0;
    }
    // 退出倒车模式: 按油门 或 前进速度足够
    if(input.acc || c.speed > 3){
      c.inReverse = false;
      c.reverseTimer = 0;
    }
    // 倒车操作: 刹车=后退加速, 油门=刹车减速
    if(c.inReverse){
      if(input.brake) c.speed -= 15 * dt;   // 后退加速
      if(input.acc) c.speed += 25 * dt;     // 减速 (朝0)
      // 倒车时松开按键: 自然减速
      if(!input.brake && !input.acc){
        c.speed += Math.sign(0 - c.speed) * 8 * dt;
        if(Math.abs(c.speed) < 0.5) c.speed = 0;
      }
    }
  } else if(c.inReverse){
    // 非 racing 阶段 (暂停/结束) 强制退出倒车
    c.inReverse = false;
    c.reverseTimer = 0;
  }
  // 轮胎类型速度加成: Soft +12%, 衰减乘数, 爆胎限速 40%
  const blowoutLimit = c.tire <= 0 ? 0.4 : 1.0;
  const tireSpeedFactor = (c.tireType==='soft' ? 1.12 : 1.0) * c.tireSpeedMult * blowoutLimit;
  const maxv = c.maxSpeed * tireSpeedFactor * (c.drsActive?1.12:1)*(ersBoost>0?1.08:1)*(tow>0?1+tow/100:1);
  const minv = c.inReverse ? -0.3 * c.maxSpeed : 0;
  c.speed=THREE.MathUtils.clamp(c.speed + ersBoost*dt + drsBoost*dt + tow*dt, minv, maxv);
  // 倒车模式下的 ERS/DRS/tow 不应叠加 (这些是前进动力)
  if(c.inReverse){
    c.speed = THREE.MathUtils.clamp(c.speed, minv, 0); // 倒车时不超过0
  }
  // === 维修区限速: 80 km/h (22 m/s) 硬限制, 渐进减速 ===
  if(isInPitLane(c.pos) && c.speed > PIT_SPEED_LIMIT){
    c.speed = Math.max(PIT_SPEED_LIMIT, c.speed - 30 * dt); // 渐进减速
  }

  c.fuel=Math.max(0,c.fuel-(input.acc?0.012:0.004)*dt*(1+tow*0.1));
  // 燃油少=车轻=速度略快 (真实F1物理), 但燃油低于5%会降速保护引擎
  const fuelBonus = c.fuel > 5 ? 1 + (100 - c.fuel) * 0.0008 : 0.85;
  const fuelPenalty = fuelBonus;

  // ===== 平滑转向 =====
  // 从 steerLeft/steerRight 计算目标值，然后平滑过渡
  const steerTarget = (input.steerLeft?1:0) - (input.steerRight?1:0);
  const steerRate = 2.5; // 每秒最大转向变化量 (降低灵敏度, 原 3.5)
  const steerDiff = steerTarget - input.steer;
  input.steer += THREE.MathUtils.clamp(steerDiff, -steerRate*dt, steerRate*dt);

  // ===== 转向: 下压力抓地 + 重量转移 + 摩擦圆 =====
  const steer = input.steer;
  const v=Math.abs(c.speed);
  const speedFactor=THREE.MathUtils.clamp(v/8,0,1);
  // 下压力抓地: grip = base + k*v² (高速过弯更稳)
  const downforceGrip = 1 + 0.00015 * v * v;  // v=80时 ~1.96倍抓地
  // 重量转移: 制动时前轮负载增加→转向更灵敏
  const brakingBoost = input.brake ? 1.2 : 1.0;
  // 摩擦圆: 刹车+转向同时操作时, 总抓地力受限
  const steerDemand = Math.abs(steer);
  const brakeDemand = input.brake ? 0.7 : 0;
  const accelDemand = input.acc ? 0.5 : 0;
  const totalDemand = Math.sqrt(steerDemand*steerDemand + brakeDemand*brakeDemand + accelDemand*accelDemand);
  const gripLimit = 1.0;
  const gripScale = totalDemand > gripLimit ? gripLimit/totalDemand : 1.0;

  const tireGrip2=0.7+0.3*(c.tire/100);
  const effectiveGrip = tireGrip2 * downforceGrip * brakingBoost * gripScale;
  // 速度自适应转向: 低速灵活 (+15%), 高速稳定 (-30%)
  const speedKmh = v * 3.6; // 转换为 km/h (假设 1 unit ≈ 1 m/s)
  const speedSteerMult = speedKmh < 22 ? 1.15 : speedKmh > 55 ? 0.70 : 1.0;
  // 转向方向: 前进时正常, 倒车时反向 (真实车辆物理), 静止时不转
  const steerSign = c.speed > 0.5 ? 1 : c.speed < -0.5 ? -1 : 0;
  c.heading += steer*c.turnRate*speedFactor*effectiveGrip*speedSteerMult*dt*steerSign;

  // 速度向量 (带漂移)
  const fwd=new THREE.Vector3(Math.sin(c.heading),0,Math.cos(c.heading));
  const desired=fwd.clone().multiplyScalar(c.speed*fuelPenalty);
  // 漂移因子: 低速惯性大(漂移因子小), 高速下压力大→抓地强(漂移因子大)
  // 真实F1: 高速下压力提供强抓地力, 转向响应更快
  const driftBase = THREE.MathUtils.clamp(0.15 + v * 0.002, 0.12, 0.42);
  const driftFactor = driftBase * Math.max(0.5, effectiveGrip * 0.8);
  c.velocity.lerp(desired, Math.min(driftFactor,1));
  c.pos.addScaledVector(c.velocity,dt);

  // 围栏硬碰撞 (冲不出去) — 第一次碰撞处理
  barrierCollision(c);
  // 二次防穿模: 检查所有角点, 任何穿透则推回
  {
    const corners2 = getCarCorners(c);
    let worstOV = 0, worstN = null, worstS = 0;
    for(const cr of corners2){
      const cs = nearestSegment(cr);
      if(cs.absLat > WALL_DIST){ const ov = cs.absLat - WALL_DIST; if(ov > worstOV){ worstOV = ov; worstN = cs.normal; worstS = Math.sign(cs.lateral); } }
    }
    const csC = nearestSegment(c.pos);
    if(csC.absLat > WALL_DIST){ const ov = csC.absLat - WALL_DIST; if(ov > worstOV){ worstOV = ov; worstN = csC.normal; worstS = Math.sign(csC.lateral); } }
    if(worstOV > 0) c.pos.addScaledVector(worstN, -worstS * (worstOV + 0.05));
  }

  // 齿轮 / RPM (基于真实换挡曲线)
  const gearRange=Math.max(1e-6, c.maxSpeed/8); // 除零防护
  c.gear=THREE.MathUtils.clamp(1+Math.floor(c.speed/gearRange),1,8);
  let gearFrac=THREE.MathUtils.clamp((c.speed-(c.gear-1)*gearRange)/gearRange,0,1);
  if(!isFinite(gearFrac)) gearFrac=0; // NaN 防护
  c.rpm = 3000 + gearFrac*(14500-3000);

  applyMesh(c);
  updateProgress(c, dt);
}

// AI 物理 (带理想走线 + 恢复机制)
function updateAI(c, dt){
  // ===== 健壮性: 验证位置有效性 =====
  if(!c.pos || isNaN(c.pos.x) || isNaN(c.pos.z)){
    // 位置无效, 重置到赛道
    const rp=racingLinePoint(c.sampleIdx||0);
    c.pos.copy(rp); c.pos.y=0.6;
    c.speed=0; c.velocity.set(0,0,0);
  }

  // 注意: AI 碰撞后同样不冻结 (见 updatePlayer 注释), crashTimer 在 loop 统一计时
  // 碰撞锁定: 挂起 AI 速度重建, 让反弹真正积分
  if(c.collisionLock > 0){
    c.collisionLock -= dt;
    // 安全衰减: 确保系数为正
    const decay = Math.max(0.5, 1 - 1.0*dt);
    c.collisionVel.multiplyScalar(decay);
    // 限制碰撞速度幅值
    const cvLen = c.collisionVel.length();
    if(cvLen > 30) c.collisionVel.multiplyScalar(30/cvLen);
    c.velocity.copy(c.collisionVel);
    // 同步 speed + collisionSpin 衰减 (与玩家一致)
    c.speed = c.velocity.length() * Math.sign(c.speed || 1);
    c.collisionSpin *= Math.max(0, 1 - 3.0*dt);
    c.heading += c.collisionSpin * dt * 0.3;
    c.pos.addScaledVector(c.velocity, dt);
    // NaN保护
    if(isNaN(c.pos.x)||isNaN(c.pos.z)){
      const rp=racingLinePoint(c.sampleIdx||0);
      c.pos.copy(rp); c.pos.y=0.6;
      c.speed=0; c.velocity.set(0,0,0);
      c.collisionLock = 0;
    }
    barrierCollision(c);
    applyMesh(c);
    updateProgress(c, dt);
    return;
  }
  // 碰撞冷却期: 防止反复碰撞卡死 (0.5秒内不再触发车车碰撞)
  if(c.collisionCooldown > 0){
    c.collisionCooldown -= dt;
  }
  if(race.phase!=='racing'){ c.speed*=0.9; applyMesh(c); updateProgress(c,dt); return; }

  // === AI 进站状态机 (真正驶入维修通道) ===
  if(c.pitting){
    // 进站超时保护: 30秒未完成则取消
    if(!c._pitEntryTimer) c._pitEntryTimer = 0;
    c._pitEntryTimer += dt;
    if(c._pitEntryTimer > 30){
      c.pitting = false; c.pitPhase = null; c._pitEntryTimer = 0;
      c.recoveryMode = true; c.recoveryTimer = 1.0;
      return; // 超时取消, 直接返回
    }
    const pitLen = PIT_EXIT_X - PIT_ENTRY_X;
    const pitBoxSpacing = pitLen / 12;
    const boxX = PIT_ENTRY_X + pitBoxSpacing * (c.pitBoxIdx + 1.5);

    if(c.pitPhase === 'entering'){
      // 阶段1: 从主赛道驶向维修通道入口
      const entryTarget = new THREE.Vector3(PIT_ENTRY_X + 15, 0, PIT_LANE_Z);
      const dx = entryTarget.x - c.pos.x;
      const dz = entryTarget.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      let diff = desired - c.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      c.heading += THREE.MathUtils.clamp(diff, -c.turnRate * dt, c.turnRate * dt);
      // 减速到限速以下
      const targetSpeed = Math.min(PIT_SPEED_LIMIT * 0.9, 20);
      c.speed += THREE.MathUtils.clamp(targetSpeed - c.speed, -35, c.accel * 0.4) * dt;
      c.speed = Math.max(2, c.speed);
      // 进入维修通道
      if(isInPitLane(c.pos)){
        c.pitPhase = 'driving';
      }
    } else if(c.pitPhase === 'driving'){
      // 阶段2: 沿维修通道行驶到分配的维修位 (靠建筑侧停车, 留出快车道)
      const boxTarget = new THREE.Vector3(boxX, 0, PIT_LANE_Z - PIT_LANE_HALF_W + 3);
      const dx = boxTarget.x - c.pos.x;
      const dz = boxTarget.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      let diff = desired - c.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      c.heading += THREE.MathUtils.clamp(diff, -c.turnRate * 0.5 * dt, c.turnRate * 0.5 * dt);
      // 限速 80km/h
      let targetSpeed = PIT_SPEED_LIMIT;
      // 接近维修位时开始减速
      if(dist < 15) targetSpeed = Math.max(3, PIT_SPEED_LIMIT * (dist / 15));
      c.speed += THREE.MathUtils.clamp(targetSpeed - c.speed, -30, c.accel * 0.3) * dt;
      if(c.speed > PIT_SPEED_LIMIT) c.speed = Math.max(PIT_SPEED_LIMIT, c.speed - 30 * dt);
      // 到达维修位, 停车换胎
      if(dist < 2.5){
        c.pitPhase = 'stopped';
        c.pitTimer = c.pitStopDuration || 4.5;
        c.speed = 0;
      }
    } else if(c.pitPhase === 'stopped'){
      // 阶段3: 停在维修位, 等待换胎完成
      c.speed = 0;
      c.pitTimer -= dt;
      if(c.pitTimer <= 0){
        // 换胎完成: 重置轮胎状态
        c.tire = 100; c.fuel = 100; c.pits++;
        c.tireWearLaps = 0; c.tireDegraded = false;
        c.tireSpeedMult = 1.0; c.tireGripMult = 1.0;
        c.tireBlowoutTriggered = false;
        c.pitPhase = 'exiting';
      }
    } else if(c.pitPhase === 'exiting'){
      // 阶段4: 从维修通道驶出, 回到主赛道 (目标设在赛道中心 z=340)
      const exitTarget = new THREE.Vector3(PIT_EXIT_X + 10, 0, 340);
      const dx = exitTarget.x - c.pos.x;
      const dz = exitTarget.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      let diff = desired - c.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      c.heading += THREE.MathUtils.clamp(diff, -c.turnRate * dt, c.turnRate * dt);
      // 加速, 但维修通道内仍限速
      let targetSpeed = Math.min(PIT_SPEED_LIMIT + 8, 28);
      c.speed += THREE.MathUtils.clamp(targetSpeed - c.speed, -15, c.accel * 0.5) * dt;
      if(isInPitLane(c.pos) && c.speed > PIT_SPEED_LIMIT){
        c.speed = Math.max(PIT_SPEED_LIMIT, c.speed - 30 * dt);
      }
      // 离开维修通道并接近主赛道
      if(!isInPitLane(c.pos) && c.pos.z > 330){
        c.pitting = false;
        c.pitPhase = null;
        c._pitEntryTimer = 0;
        c.recoveryMode = true;
        c.recoveryTimer = 1.0;
      }
    }
    // 进站期间: 移动 + 碰撞 + 渲染 (跳过正常巡航逻辑)
    const fwd = new THREE.Vector3(Math.sin(c.heading), 0, Math.cos(c.heading));
    c.velocity.copy(fwd).multiplyScalar(c.speed);
    c.pos.addScaledVector(c.velocity, dt);
    barrierCollision(c);
    applyMesh(c);
    updateProgress(c, dt);
    return;
  }

  // === AI 轮胎消耗 (与玩家公式对齐) + 进站决策 ===
  {
    // 轮胎磨损: 与玩家公式一致 (基础0.12 + 加速0.08 + 转向0.06 + 高速0.04)
    const aiAccel = c.speed < c.maxSpeed * 0.9; // AI默认加速
    const aiSteer = Math.abs(c.heading - (c._lastHeading || c.heading));
    const aiSpeedFactor = c.speed > 50 ? 0.04 : 0;
    const wear = 0.12 + (aiAccel ? 0.08 : 0) + Math.min(0.06, aiSteer) + aiSpeedFactor;
    c.tire = Math.max(0, c.tire - wear * dt);
    c.fuel = Math.max(0, c.fuel - 0.007 * dt);
    const inPitZone = (c.progress > 0.92 || c.progress < 0.08);
    const lapsLeft = totalLaps - c.lap;
    const strat = c.pitStrategy || 'balanced';
    let shouldPit = false;
    if(strat === 'aggressive'){
      shouldPit = c.tire < 40 && inPitZone && lapsLeft > 1 && c.pits < 3;
    } else if(strat === 'conservative'){
      shouldPit = (c.tireDegraded || c.tire < 12) && inPitZone && lapsLeft > 1 && c.pits < 3;
    } else {
      shouldPit = (c.tireDegraded || c.tire < 22) && inPitZone && lapsLeft > 1 && c.pits < 3;
    }
    if(shouldPit){
      c.pitting = true;
      c.pitPhase = 'entering';
      c._pitEntryTimer = 0;
    }
  }

  // === 恢复/巡航分离: 恢复模式独占转向 ===
  if(c.recoveryMode){
    c.recoveryTimer -= dt;
    const tgt = racingLinePoint((c.sampleIdx+3)%NSAMP);
    const dx = tgt.x - c.pos.x, dz = tgt.z - c.pos.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - c.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.heading += THREE.MathUtils.clamp(diff, -c.turnRate*0.6*dt, c.turnRate*0.6*dt);
    c.speed = THREE.MathUtils.clamp(c.speed + 10*dt, 0, c.maxSpeed*0.4);
    // 退出校验: 回赛道+有速度 (放宽条件, 防止卡死)
    const seg = nearestSegment(c.pos);
    const backOnTrack = seg.absLat < HALF_W * 0.75; // 放宽到 0.75
    if(c.recoveryTimer <= 0 && backOnTrack && c.speed > c.maxSpeed*0.2){
      c.recoveryMode = false;
    } else if(c.recoveryTimer <= 0){ c.recoveryTimer = 0.3; } // 缩短重试间隔
  } else {
    // === 巡航: 严格沿固定走线 + 微量变化 ===
    const aheadTan = TANGENTS[(c.sampleIdx+8)%NSAMP];
    const curTan = TANGENTS[c.sampleIdx];
    const straightnessCruise = aheadTan.x*curTan.x + aheadTan.z*curTan.z;
    // 弯道看近(精准), 直道看远(稳定)
    const lookAhead = Math.floor(4 + straightnessCruise * c.speed * 0.25);
    const tgtIdx = (c.sampleIdx + lookAhead) % NSAMP;
    const idealPt = racingLinePoint(tgtIdx);
    const bias = c.racingLineBias;
    const precision = c.linePrecision;
    const sideN = SIDENORMALS[tgtIdx];
    // 偏好偏移: 缩小幅度, 不超过 ±1.5m
    const biasOffset = (bias - 0.5) * HALF_W * 0.35;
    // 低频噪声: 缩小幅度
    c.noiseTimer -= dt;
    if(c.noiseTimer <= 0){ c.noiseTimer = 0.6; c.noiseTarget = (Math.random()-0.5); }
    c.noiseVal += (c.noiseTarget - c.noiseVal) * Math.min(1, 2*dt);
    const variation = c.noiseVal * HALF_W * (1 - precision) * 0.35;
    // 合成偏移: 走线偏移 + 偏好 + 噪声, 钳制到 ±HALF_W*0.55
    let totalOffset = biasOffset + variation + RACING_LINE_OFFSET[tgtIdx]*HALF_W*0.75;
    // === NPC 避障: 扫描前方 50m 内的车辆 ===
    let avoidOffset = 0;
    for(const other of cars){
      if(other === c) continue;
      const adx = other.pos.x - c.pos.x, adz = other.pos.z - c.pos.z;
      const aDist = Math.hypot(adx, adz);
      if(aDist > 50 || aDist < 0.5) continue;
      // 检查是否在前方 (而非后方)
      const dotFwd = adx * Math.sin(c.heading) + adz * Math.cos(c.heading);
      if(dotFwd < 0) continue; // 在后方, 忽略
      // 计算横向偏移: 其他车在左还是右
      const lateral = adx * sideN.x + adz * sideN.z;
      const avoidDir = lateral > 0 ? -1 : 1; // 向反方向避让
      const avoidStrength = Math.max(0, 1 - aDist / 50) * 3.0; // 越近越强
      avoidOffset += avoidDir * avoidStrength;
      // 如果前方有车且距离近, 适当减速
      if(aDist < 20) c.speed *= (1 - 0.3 * (1 - aDist/20) * dt * 10);
    }
    // === NPC 让线: 后方快车 30m 检测 ===
    let yieldOffset = 0;
    for(const other of cars){
      if(other === c) continue;
      const adx = other.pos.x - c.pos.x, adz = other.pos.z - c.pos.z;
      const aDist = Math.hypot(adx, adz);
      if(aDist > 30 || aDist < 1) continue;
      // 检查是否在后方
      const dotBehind = adx * Math.sin(c.heading) + adz * Math.cos(c.heading);
      if(dotBehind >= 0) continue; // 在前方, 忽略
      // 检查后方车是否更快 (至少快 5 m/s)
      if(other.speed <= c.speed + 5) continue;
      // 后方快车在左还是右
      const lateral = adx * sideN.x + adz * sideN.z;
      // 让线方向: 向远离快车的一侧移动
      const yieldDir = lateral > 0 ? -1 : 1;
      // 安全检查: 让线方向是否有其他车阻挡
      let yieldBlocked = false;
      for(const blocker of cars){
        if(blocker === c || blocker === other) continue;
        const bdx = blocker.pos.x - c.pos.x, bdz = blocker.pos.z - c.pos.z;
        const bDist = Math.hypot(bdx, bdz);
        if(bDist > 20) continue;
        const bLat = bdx * sideN.x + bdz * sideN.z;
        // 如果阻挡者在让线方向上且距离 < 12m, 放弃让线
        if(Math.sign(bLat) === yieldDir && bDist < 12){ yieldBlocked = true; break; }
      }
      if(!yieldBlocked){
        const yieldStrength = Math.max(0, 1 - aDist / 30) * 2.5;
        yieldOffset += yieldDir * yieldStrength;
      }
    }
    // 5% 概率反应延迟 (模拟注意力分散)
    if(Math.random() < 0.05) avoidOffset *= 0.3;
    totalOffset += avoidOffset + yieldOffset;
    totalOffset = THREE.MathUtils.clamp(totalOffset, -HALF_W*0.55, HALF_W*0.55);
    const targetX = idealPt.x + sideN.x * totalOffset;
    const targetZ = idealPt.z + sideN.z * totalOffset;
    const desired = Math.atan2(targetX - c.pos.x, targetZ - c.pos.z);
    let diff = desired - c.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const gripVal = 0.7 + 0.3 * c.aiSkill;
    c.heading += THREE.MathUtils.clamp(diff, -c.turnRate*gripVal*dt, c.turnRate*gripVal*dt);
  }

  // === 速度控制: 曲率驱动减速 (v²=a_lat/κ) ===
  const grip = 0.7 + 0.3 * c.aiSkill;
  const tireGrip = (0.6 + 0.4*(c.tire/100)) * (c.tireGripMult || 1.0);
  const aT=TANGENTS[(c.sampleIdx+8)%NSAMP], cT=TANGENTS[c.sampleIdx];
  const straightness=aT.x*cT.x + aT.z*cT.z;
  // 取前方曲率预刹 (提前量加大, 更早减速)
  let kappa = CURVATURE[c.sampleIdx];
  for(let di=1; di<=18; di++){
    const k = CURVATURE[(c.sampleIdx+di)%NSAMP];
    if(k > kappa) kappa = k;
  }
  const maxLatAccel = 32 * tireGrip * c.aiSkill;
  const cornerSpeed = Math.sqrt(maxLatAccel / Math.max(kappa, 1e-4));
  const aiTireSpeed = c.tireSpeedMult || 1.0;
  let targetSpeed = Math.min(c.maxSpeed * c.aiSkill * tireGrip * aiTireSpeed, cornerSpeed);
  if(c.recoveryMode) targetSpeed = Math.min(targetSpeed, c.maxSpeed * 0.4);

  // === AI DRS ===
  c.drsActive=false; c.drsAvailable=false;
  let inDRSZone=false;
  for(const [a,b] of DRS_ZONES){
    const prog=c.progress;
    if(a>b){ if(prog>=a||prog<=b) inDRSZone=true; }
    else { if(prog>=a&&prog<=b) inDRSZone=true; }
  }
  if(inDRSZone&&!c.recoveryMode){
    const gap=getGapToAhead(c);
    if(gap.gapSeconds<=1.5&&gap.ahead){
      c.drsAvailable=true; c.drsActive=true;
      targetSpeed*=1.12;
    }
  }

  // === AI ERS ===
  let ersBoost=0;
  const isStraight=straightness>0.92;
  const gapInfo=getGapToAhead(c);
  const canOvertake=gapInfo.gapSeconds<2.5&&gapInfo.gapSeconds>0.3;
  // 爆胎时 ERS 效果减半 (报告要求)
  const ersBlowoutFactor = c.tire <= 0 ? 0.5 : 1.0;
  if((isStraight||canOvertake)&&c.ers>10&&c.speed>c.maxSpeed*0.6&&!c.recoveryMode){
    ersBoost=12*ersBlowoutFactor; c.ers=Math.max(0,c.ers-20*dt);
  } else {
    const isBraking=c.speed>targetSpeed;
    c.ers=Math.min(100,c.ers+(isBraking?22:4)*dt);
  }
  if(ersBoost>0) targetSpeed*=1+(0.08*ersBlowoutFactor);

  // 加速/减速
  c.speed += THREE.MathUtils.clamp(targetSpeed-c.speed,-55,c.accel*grip)*dt;
  c.speed=THREE.MathUtils.clamp(c.speed,0,c.maxSpeed*1.15);
  // === 维修区限速 (AI) ===
  if(isInPitLane(c.pos) && c.speed > PIT_SPEED_LIMIT){
    c.speed = Math.max(PIT_SPEED_LIMIT, c.speed - 30 * dt);
  }

  // 最低速度保底 (正常模式 + 碰撞后强制提速)
  const minSpeed = c.collisionCooldown > 0 ? c.maxSpeed*0.45 : c.maxSpeed*0.35;
  if(!c.recoveryMode && c.speed < minSpeed) c.speed = minSpeed;

  // === 避让 ===
  for(const o of cars){ if(o===c)continue;
    const dx=o.pos.x-c.pos.x, dz=o.pos.z-c.pos.z;
    const dist=Math.hypot(dx,dz);
    if(dist<11&&dist>0.1){
      const fwd={x:Math.sin(c.heading),z:Math.cos(c.heading)};
      const dot=(dx*fwd.x+dz*fwd.z)/dist;
      if(dot>0.5){
        const avoidStrength=(11-dist)/11;
        c.heading += avoidStrength*dt*Math.sign(Math.sin(c.heading)*dz-Math.cos(c.heading)*dx+0.01);
      }
    }
  }

  // === 防卡死 (绝对低速 + 无进展双条件) ===
  if(!c._stuckTimer) c._stuckTimer=0;
  const lowSpeed = c.speed < Math.max(6, c.maxSpeed*0.10);
  if(lowSpeed) c._stuckTimer+=dt;
  else c._stuckTimer=0;
  if(c._stuckTimer>2.5){
    // 智能恢复: 朝向最近的理想走线点
    const rp=racingLinePoint(c.sampleIdx);
    const rx=rp.x-c.pos.x, rz=rp.z-c.pos.z;
    c.heading=Math.atan2(rx,rz);
    c.speed=c.maxSpeed*0.5;
    c._stuckTimer=0;
    c.recoveryMode=true; c.recoveryTimer=1.0;
  }

  // === 移动 + 碰撞 ===
  const fwd=new THREE.Vector3(Math.sin(c.heading),0,Math.cos(c.heading));
  c.velocity.copy(fwd).multiplyScalar(c.speed);
  c.pos.addScaledVector(c.velocity,dt);
  const collResult=barrierCollision(c);
  // 二次防穿模: 检查所有角点, 任何穿透则推回
  {
    const corners2 = getCarCorners(c);
    let worstOV = 0, worstN = null, worstS = 0;
    for(const cr of corners2){
      const cs = nearestSegment(cr);
      if(cs.absLat > WALL_DIST){ const ov = cs.absLat - WALL_DIST; if(ov > worstOV){ worstOV = ov; worstN = cs.normal; worstS = Math.sign(cs.lateral); } }
    }
    const csC = nearestSegment(c.pos);
    if(csC.absLat > WALL_DIST){ const ov = csC.absLat - WALL_DIST; if(ov > worstOV){ worstOV = ov; worstN = csC.normal; worstS = Math.sign(csC.lateral); } }
    if(worstOV > 0) c.pos.addScaledVector(worstN, -worstS * (worstOV + 0.05));
  }
  // 撞墙: 仅在重撞时触发恢复模式, 轻擦则继续滑行
  if(collResult&&collResult.hit){
    // 仅在 crashTimer 触发(高速重撞)时进入恢复, 轻擦不中断巡航
    if(c.crashTimer > 0){
      c.recoveryMode=true; c.recoveryTimer=1.2;
      c._stuckTimer=0;
    }
  }
  // 最低速度保底仅在非恢复且非碰撞锁定时
  if(!c.recoveryMode && c.collisionLock<=0){
    if(c.speed<c.maxSpeed*0.25) c.speed=Math.max(c.speed,c.maxSpeed*0.3);
  }

  applyMesh(c);
  updateProgress(c,dt);
  c._lastHeading = c.heading; // 保存当前朝向, 供下一帧轮胎磨损计算
}

function applyMesh(c){
  c.mesh.position.copy(c.pos);
  c.mesh.rotation.y=c.heading;

  // === 悬挂/重量转移 (纯视觉, 弹簧-阻尼模型; 真实F1悬挂硬, 幅度克制) ===
  const sus=c._sus||(c._sus={pitch:0,pitchV:0,roll:0,rollV:0,y:0,yV:0,prevSpeed:c.speed||0,prevH:c.heading,phase:Math.random()*7});
  const dtS=1/60;
  // 纵向加速度 (速度差分): 制动→点头(前俯), 加速→抬头(后蹲)
  const dV=(c.speed-sus.prevSpeed)/dtS;
  sus.prevSpeed=c.speed;
  // 横向加速度 ≈ yaw率 × 速度: 过弯→外倾
  let dH=c.heading-sus.prevH;
  while(dH>Math.PI)dH-=2*Math.PI;
  while(dH<-Math.PI)dH+=2*Math.PI;
  sus.prevH=c.heading;
  const latA=(dH/dtS)*THREE.MathUtils.clamp(c.speed,-40,40);
  const tgtPitch=THREE.MathUtils.clamp(-dV*0.0016,-0.035,0.035);
  const tgtRoll=THREE.MathUtils.clamp(latA*0.0012,-0.03,0.03);
  // 弹簧-阻尼趋近目标姿态
  sus.pitchV += ((tgtPitch-sus.pitch)*60 - sus.pitchV*10)*dtS;
  sus.pitch += sus.pitchV*dtS;
  sus.rollV += ((tgtRoll-sus.roll)*60 - sus.rollV*10)*dtS;
  sus.roll += sus.rollV*dtS;
  // 垂直: 路面噪声(随速度) + 碰撞冲击回弹 (重力感)
  const spd=Math.abs(c.speed);
  sus.phase+=dtS*(8+spd*0.25);
  const roadNoise=Math.sin(sus.phase)*0.012*Math.min(1,spd/40);
  sus.yV += (-sus.y*80 - sus.yV*12)*dtS;
  sus.y += sus.yV*dtS;
  c.mesh.position.y = Math.max(-0.06, sus.y + roadNoise);

  // 合成旋转: 悬挂姿态 + 撞墙翻滚动画 (Z/X轴)
  let rx=sus.pitch, rz=sus.roll;
  if(c.crashTimer>0){
    const t=1-(c.crashTimer/0.3);
    rz += c.crashAngle * Math.sin(t*Math.PI) * 0.8;
    rx += Math.sin(t*Math.PI) * 0.3;
  }
  c.mesh.rotation.z=rz;
  c.mesh.rotation.x=rx;

  if(c.mesh.userData.frontWheels){
    const steer=(c===player)?(input.steer*0.5):0.3;
    for(const w of c.mesh.userData.frontWheels) w.rotation.y=steer;
  }
}

// ---------- 进度 / 圈速 ----------
function updateProgress(c, dt){
  const near=nearestSample(c.pos);
  const newIdx=near.idx;
  const prevProg=c.progress;
  let newProg=newIdx/NSAMP;
  c.sampleIdx=newIdx;
  c.progress=newProg;

  if(race.phase!=='racing') return;

  // 初始化sector通过记录
  if(c.sectorsPassed===undefined) c.sectorsPassed=[false,false,false];

  const totalPrev = c.lap+prevProg;
  let totalNew = c.lap+newProg;

  // 检测Sector通过 (必须前进方向)
  const isMovingForward = c.speed > 2 || (c.velocity.lengthSq() > 1);
  if(isMovingForward){
    if(prevProg<S1_END && newProg>=S1_END && c.lap>=0){
      recordSector(c,0);
      c.sectorsPassed[0]=true;
    }
    if(prevProg<S2_END && newProg>=S2_END && c.sectorsPassed[0]){
      recordSector(c,1);
      c.sectorsPassed[1]=true;
    }
  }

  // 圈数检测 + Sector验证 (必须依次通过S1和S2才算有效圈)
  if(prevProg>0.9 && newProg<0.1){
    if(c.sectorsPassed[0] && c.sectorsPassed[1]){
      // 有效圈
      completeLap(c);
      c.sectorsPassed=[false,false,false]; // 重置
      totalNew = c.lap+newProg;
    }
    // 如果sector验证不通过, 不计圈 (防止抄近道/倒车作弊)
  }
}

let raceClock=0;
function recordSector(c, idx){
  const t=raceClock-c.curSectorStart;
  c.curSectorStart=raceClock;
  c.sectorTimes[idx]=t;
  if(c.bestSector[idx]===null || t<c.bestSector[idx]){
    c.bestSector[idx]=t;
    if(c.isPlayer) flashSector(idx,'purple');
  } else if(c.isPlayer){
    flashSector(idx,'yellow');
  }
  if(c.isPlayer) renderSectorUI();
}
function completeLap(c){
  if(c.finished) return;
  const t=raceClock-c.curSectorStart;
  c.sectorTimes[2]=t;
  c.curSectorStart=raceClock;
  if(c.bestSector[2]===null||t<c.bestSector[2]){ c.bestSector[2]=t; if(c.isPlayer)flashSector(2,'purple'); }
  else if(c.isPlayer) flashSector(2,'green');
  const lapTime=c.sectorTimes[0]+c.sectorTimes[1]+c.sectorTimes[2];
  if(c.bestLap===null||lapTime<c.bestLap) c.bestLap=lapTime;
  // 保存上一圈数据 (供HUD显示)
  c.lastSectorTimes=[...c.sectorTimes];
  c.lastLapTime=lapTime;
  c.sectorTimes=[null,null,null];
  c.lap++;
  c.lapStartTime=raceClock; // 新圈起点
  // === 轮胎磨损 (圈数制) ===
  c.tireWearLaps++;
  if(c.tireWearLaps >= c.tireMaxLaps){
    c.tireDegraded = true;
    // 衰减后性能下降: 不低于基准的60%
    c.tireSpeedMult = Math.max(0.6, 1.0 - (c.tireWearLaps - c.tireMaxLaps) * 0.15);
    c.tireGripMult = Math.max(0.6, 1.0 - (c.tireWearLaps - c.tireMaxLaps) * 0.12);
  }
  if(c.isPlayer){
    renderSectorUI();
    if(c.lap===totalLaps-1) flashMsg('FINAL LAP','最后一圈');
    if(c.lastLapTime!=null) flashMsg('LAP '+c.lap, fmt(c.lastLapTime));
    if(c.tireDegraded) flashMsg('TIRE WARN','轮胎衰减! 需进站换胎');
  }
  if(c.lap>=totalLaps){
    c.finished=true; c.finishTime=raceClock;
    if(c.isPlayer) endRace();
  }
}

// ============================================================
//  相机: 第三人称(跟车) / 第一人称(座舱) — C键切换
// ============================================================
let camMode=0; // 0=第三人称, 1=第一人称
let camShake=0; // 碰撞屏幕震动
const camPos=new THREE.Vector3(0,8,40);
const camLook=new THREE.Vector3();
function updateCamera(dt){
  if(!player) return;
  const c=player;
  const fwd=new THREE.Vector3(Math.sin(c.heading),0,Math.cos(c.heading));
  const right=new THREE.Vector3(fwd.z,0,-fwd.x);
  // yaw 率 (过弯摆动参考)
  if(c._camPrevH===undefined) c._camPrevH=c.heading;
  let dh=c.heading-c._camPrevH;
  while(dh>Math.PI)dh-=2*Math.PI;
  while(dh<-Math.PI)dh+=2*Math.PI;
  const yawRate=dh/Math.max(dt,1e-3);
  c._camPrevH=c.heading;
  const spd=c.velocity.length();
  if(camMode===1){
    // 第一人称: 驾驶员视角 (放大1.5x后的座舱比例)
    const eyePos=c.pos.clone().addScaledVector(fwd,1.2).add(new THREE.Vector3(0,1.15,0));
    camera.position.copy(eyePos);
    camLook.copy(c.pos).addScaledVector(fwd,40).add(new THREE.Vector3(0,0.15,0));
    camera.lookAt(camLook);
    const tgtFov=76+THREE.MathUtils.clamp(spd/82,0,1)*14;
    camera.fov+=(tgtFov-camera.fov)*0.12; camera.updateProjectionMatrix();
    // 第一人称时隐藏自身车体 (避免遮挡)
    if(!c.mesh.userData._hidden){ c.mesh.visible=false; c.mesh.userData._hidden=true; }
  } else {
    // 第三人称: 近低趴转播视角 (真实赛车游戏相机)
    if(c.mesh.userData._hidden){ c.mesh.visible=true; c.mesh.userData._hidden=false; }
    const desired=c.pos.clone().addScaledVector(fwd,-7.0).add(new THREE.Vector3(0,2.8,0));
    // 相机惯性: 略慢的跟随, 不硬贴
    const k=1-Math.pow(0.008,dt);
    camPos.lerp(desired,k);
    camera.position.copy(camPos);
    // 注视点: 前方14m + 随yaw率横向摆动 (过弯时车身在画面中摆动 → 重量感)
    camLook.copy(c.pos).addScaledVector(fwd,14)
      .addScaledVector(right, THREE.MathUtils.clamp(-yawRate*1.2,-2.5,2.5))
      .add(new THREE.Vector3(0,1.0,0));
    camera.lookAt(camLook);
    const tgtFov=66+THREE.MathUtils.clamp(spd/82,0,1)*16;
    camera.fov+=(tgtFov-camera.fov)*0.08; camera.updateProjectionMatrix();
  }
  // 高速微颤 (贴地飞行感)
  const vib=Math.max(0,(spd-50)/32)*0.06;
  if(vib>0.001){
    camera.position.x+=(Math.random()-0.5)*vib;
    camera.position.y+=(Math.random()-0.5)*vib*0.7;
  }
  // 屏幕震动 (碰撞时) - 降低强度，加快衰减
  if(camShake>0.01){
    camera.position.x+=(Math.random()-0.5)*camShake*0.15;
    camera.position.y+=(Math.random()-0.5)*camShake*0.15;
    camShake=Math.max(0, camShake-dt*6); // 衰减加快 50%
  }
}

// ============================================================
//  比赛 / 起步
// ============================================================
const race={ phase:'menu', lights:0, lightTimer:0, yellowUntil:0 };
let difficulty='normal'; // easy, normal, hard

// === 车辆选择系统 (Garage) — 与 TEAMS 数组数据同步 ===
const GARAGE_CARS = [
  { name:'Red Bull',  driver:'VER', color:0x3671C6, num:1,  maxSpeed:83, short:'RBR' },
  { name:'Ferrari',   driver:'LEC', color:0xE80020, num:16, maxSpeed:82, short:'FER' },
  { name:'Mercedes',  driver:'RUS', color:0x27F4D2, num:63, maxSpeed:81, short:'MER' },
  { name:'McLaren',   driver:'NOR', color:0xFF8000, num:4,  maxSpeed:82, short:'MCL' },
  { name:'Aston Martin', driver:'ALO', color:0x229971, num:14, maxSpeed:80, short:'AMR' },
  { name:'Alpine',    driver:'GAS', color:0x0093CC, num:10, maxSpeed:80, short:'ALP' },
  { name:'Williams',  driver:'ALB', color:0x64C4FF, num:23, maxSpeed:79, short:'WIL' },
  { name:'RB',         driver:'TSU', color:0x6692FF, num:22, maxSpeed:79, short:'RB' },
  { name:'Sauber',    driver:'BOT', color:0x52E252, num:77, maxSpeed:78, short:'SAU' },
  { name:'Haas',      driver:'MAG', color:0xB6BABD, num:20, maxSpeed:78, short:'HAS' },
];
const CUSTOM_COLORS = [0xff3333,0xff8800,0xffcc00,0x00ff44,0x00d4ff,0x0033ff,0xcc00ff,0xff0066,0xffffff,0x333333];
let selectedCarIdx = 0;
let selectedTireType = 'soft';
let selectedPaintMode = 'team'; // 'team' | 'custom'
let selectedCustomColor = 0xff3333;

function buildGarageUI(){
  const list = $('carList');
  list.innerHTML = '';
  GARAGE_CARS.forEach((car, i) => {
    const item = document.createElement('div');
    item.className = 'car-item' + (i === selectedCarIdx ? ' selected' : '');
    item.innerHTML = `
      <div class="car-color-dot" style="background:#${car.color.toString(16).padStart(6,'0')};color:#${car.color.toString(16).padStart(6,'0')};"></div>
      <div class="car-info">
        <div class="car-name">${car.name}</div>
        <div class="car-driver">${car.driver}</div>
      </div>
      <div class="car-num">${car.num}</div>
    `;
    item.addEventListener('click', () => {
      selectedCarIdx = i;
      document.querySelectorAll('.car-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      updateGaragePreview();
    });
    list.appendChild(item);
  });
  // 颜色调色板 (每次重建, 无重复监听器问题)
  const palette = $('colorPalette');
  palette.innerHTML = '';
  CUSTOM_COLORS.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (color === selectedCustomColor ? ' selected' : '');
    sw.style.background = '#' + color.toString(16).padStart(6, '0');
    sw.addEventListener('click', () => {
      selectedCustomColor = color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      updateGaragePreview();
    });
    palette.appendChild(sw);
  });
  updateGaragePreview();
}

// 静态按钮监听器 (只注册一次, 避免重复绑定)
  document.querySelectorAll('.tire-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tire-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedTireType = btn.dataset.tire;
      if(typeof updateGaragePreview === 'function') updateGaragePreview();
    });
  });
  // 外观选择
  document.querySelectorAll('.paint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.paint-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPaintMode = btn.dataset.paint;
      $('colorPalette').style.display = selectedPaintMode === 'custom' ? 'flex' : 'none';
      if(typeof updateGaragePreview === 'function') updateGaragePreview();
    });
  });

function updateGaragePreview(){
  const car = GARAGE_CARS[selectedCarIdx];
  const displayColor = selectedPaintMode === 'team' ? car.color : selectedCustomColor;
  $('previewColor').style.background = '#' + displayColor.toString(16).padStart(6, '0');
  $('previewColor').style.boxShadow = '0 0 12px #' + displayColor.toString(16).padStart(6, '0');
  $('pvTeam').textContent = car.name;
  $('pvDriver').textContent = car.driver;
  $('pvTire').textContent = selectedTireType === 'soft' ? 'Soft (3圈)' : 'Hard (4圈)';
  const tireBonus = selectedTireType === 'soft' ? 1.12 : 1.0;
  $('pvSpeed').textContent = (car.maxSpeed * tireBonus).toFixed(0) + ' m/s';
}

function getSelectedPlayerConfig(){
  const car = GARAGE_CARS[selectedCarIdx] || GARAGE_CARS[0];
  const color = selectedPaintMode === 'team' ? car.color : selectedCustomColor;
  return {
    teamName: car.name,
    short: car.short || car.name.substring(0,3).toUpperCase(),
    driver: car.driver,
    color: color,
    num: car.num,
    maxSpeed: car.maxSpeed,
    tireType: selectedTireType,
    tireMaxLaps: selectedTireType === 'soft' ? 3 : 4,
  };
}

// 默认比赛配置 (lobby.js 设置, 车库确认后直接开赛时使用)
let defaultRaceConfig = {};
function setDefaultRaceConfig(cfg){ defaultRaceConfig = cfg || {}; }
function openGarage(){
  buildGarageUI();
  $('startScreen').classList.add('hidden');
  $('garageScreen').classList.remove('hidden');
}
function closeGarage(){
  $('garageScreen').classList.add('hidden');
  // 联机大厅里打开车库时, 确认后返回大厅而非直接开赛 (由 lobby.js 设置)
  if(window.onGarageConfirm){ const h=window.onGarageConfirm; window.onGarageConfirm=null; h(); return; }
  startRace(defaultRaceConfig);
}

// 难度选择器 (仅主菜单, 大厅内有独立的难度控件)
document.querySelectorAll('#startScreen .diff-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#startScreen .diff-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    difficulty=btn.dataset.diff;
  });
});

// startBtn (单人练习) 由 lobby.js 绑定 → 选赛道
// 车库确认 → 开始比赛 / 返回大厅
$('confirmCarBtn').addEventListener('click', closeGarage);

// 应用车辆涂装/性能配置到车对象 (本地玩家与远程玩家共用)
// cfg: { teamName, short, driver, color, num, maxSpeed, tireType, tireMaxLaps }
function applyCarLivery(c, cfg){
  c.maxSpeed = cfg.maxSpeed;
  c.teamName = cfg.teamName;
  c.name = cfg.driver;
  c.num = cfg.num;
  c.tireType = cfg.tireType || 'soft';
  c.tireMaxLaps = cfg.tireMaxLaps || (c.tireType === 'soft' ? 3 : 4);
  c.tireCompound = c.tireType === 'soft' ? 'S' : 'H';
  // 应用自定义颜色
  const bodyMat = c.mesh.userData.bodyMat;
  if(bodyMat){
    bodyMat.color.setHex(cfg.color);
    bodyMat.emissive.setHex(cfg.color); // 同步 emissive, 夜赛辉光一致
  }
  if(c.mesh.userData.helmetMat) c.mesh.userData.helmetMat.color.setHex(cfg.color);
  // 重建侧箱纹理 (车队名+车号) 以匹配选择的车队
  if(c.mesh.userData.sidepodMat){
    const garageTeam = {
      name: cfg.teamName,
      short: cfg.short || cfg.teamName.substring(0,3).toUpperCase(),
      driver: cfg.driver,
      num: cfg.num,
      color: cfg.color,
      accent: cfg.color
    };
    const newTex = new THREE.CanvasTexture(makeCarTexture(garageTeam, true));
    c.mesh.userData.sidepodMat.map = newTex;
    c.mesh.userData.sidepodMat.color.setHex(0xffffff);
    c.mesh.userData.sidepodMat.emissive.setHex(cfg.color);
    c.mesh.userData.sidepodMat.needsUpdate = true;
  }
  // 拷贝而非改写共享 TEAMS 元素 (修复跨比赛/联机串色)
  c.team = Object.assign({}, c.team, { color:cfg.color, name:cfg.teamName, driver:cfg.driver, num:cfg.num });
  // 轮胎视觉标记 (软胎=红色, 硬胎=白色)
  if(c.mesh.userData.wheelRings){
    const tireColor = c.tireType === 'soft' ? 0xff3333 : 0xffffff;
    c.mesh.userData.wheelRings.forEach(r => r.material.color.setHex(tireColor));
  }
  // 对手头顶标记同步为车色 (远程玩家用)
  if(c.marker){
    c.marker.material.color.setHex(cfg.color);
    const ud = c.marker.userData;
    if(ud.glow) ud.glow.material.color.setHex(cfg.color);
    if(ud.beam) ud.beam.material.color.setHex(cfg.color);
    if(ud.arrow) ud.arrow.material.color.setHex(cfg.color);
  }
}

// config: { laps, difficulty, playerSlot, playerConfig,
//           remotePlayers:[{ id, slot, teamName, short, driver, color, num, maxSpeed, tireType, tireMaxLaps }] }
function startRace(config){
  config = config || defaultRaceConfig;
  if(config.laps) totalLaps = config.laps;
  if(config.difficulty) difficulty = config.difficulty;
  cars=[]; scene.children.filter(o=>o.userData&&o.userData.isCar).forEach(o=>scene.remove(o));
  const playerCfg = config.playerConfig || getSelectedPlayerConfig();
  const playerSlot = (config.playerSlot != null) ? config.playerSlot : Math.floor(NCARS/2);
  const remoteBySlot = {};
  for(const rp of (config.remotePlayers || [])) remoteBySlot[rp.slot] = rp;
  const aiFill = config.aiFill !== false;   // 联机可关闭 AI 补位
  const guestMode = !!config.guestMode;     // 客人端: 非本机车辆全部由房主广播驱动
  // 为 NPC 去重分配 pitBoxIdx (0~NCARS-1 打乱)
  const pitBoxOrder = Array.from({length: NCARS}, (_, i) => i);
  for(let i = pitBoxOrder.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [pitBoxOrder[i], pitBoxOrder[j]] = [pitBoxOrder[j], pitBoxOrder[i]];
  }
  let pitBoxAssignIdx = 0;
  const slots=[];
  for(let i=0;i<NCARS;i++) slots.push(i);
  for(const s of slots){
    const isP=(s===playerSlot);
    const rp=remoteBySlot[s]||null;
    if(!isP && !rp && !aiFill) continue; // 无 AI 补位: 只创建真人车辆
    const c=makeCar(isP,s);
    c.gridSlot=s;
    c.mesh.userData.isCar=true;
    if(guestMode && !isP) c.isRemote=true; // 客人端: AI 与远程真人一样由网络驱动
    // NPC 分配不重复的 pitBoxIdx
    if(!isP){
      c.pitBoxIdx = pitBoxOrder[pitBoxAssignIdx % pitBoxOrder.length];
      pitBoxAssignIdx++;
    }
    if(isP){
      player=c;
      applyCarLivery(c, playerCfg);
    } else if(rp){
      // 远程真人玩家: 应用其车库配置, 不跑AI, 由网络状态驱动
      c.isRemote = true;
      c.remoteId = rp.id;
      applyCarLivery(c, rp);
    }
    // 刚体参数 (Physics2D): 远程车为运动学刚体(invMass=0), 不被碰撞推离网络插值
    c._invMass = c.isRemote ? 0 : Physics2D.CAR.INV_MASS;
    c._invInertia = c.isRemote ? 0 : Physics2D.CAR.INV_INERTIA;
    cars.push(c);
  }
  raceClock=0; race.phase='grid'; race.lights=0; race.lightTimer=0;
  // 联机: 房主指定的灭灯延迟, 各端一致才能同步起跑; 单机为 null (随机)
  race.lightsOutDelay = (config.lightsOutDelay != null) ? config.lightsOutDelay : null;
  // 重置全局状态 (防止跨比赛残留)
  maxKph=0;
  if(typeof pitGame !== 'undefined'){
    pitGame.active = false;
    const pitEl = $('pitGamePanel');
    if(pitEl) pitEl.style.display = 'none';
  }
  ui.startScreen.classList.add('hidden');
  ui.garageScreen.classList.add('hidden');
  ui.overScreen.classList.add('hidden');
  ui.pauseScreen.classList.add('hidden');
  const mpRes = $('mpResults'); if(mpRes) mpRes.innerHTML='';
  const trackScr = $('trackScreen'); if(trackScr) trackScr.classList.add('hidden');
  const lobbyScr = $('lobbyScreen'); if(lobbyScr) lobbyScr.classList.add('hidden');
  buildLights();
  ui.lights.style.display='flex';
  ui.lapTotal.textContent=totalLaps;
  ui.posTotal.textContent='/'+cars.length;
  ui.raceInfo.textContent=TRACK.name+' · '+TRACK.sub+' · '+totalLaps+' LAPS';
  camPos.copy(player.pos).add(new THREE.Vector3(-7,2.8,0));
  camera.position.copy(camPos);
  for(const c of cars){ c.lapStartTime=0; }
  flashMsg('FORMATION', playerCfg.teamName + ' · ' + playerCfg.driver + ' · ' + TRACK.sub);
}

function buildLights(){
  ui.lights.innerHTML='';
  for(let i=0;i<5;i++){const d=document.createElement('div');d.className='light';ui.lights.appendChild(d);}
}
function setLights(n){
  const els=ui.lights.children;
  for(let i=0;i<5;i++){ els[i].className='light'+(i<n?' on':''); }
}
function lightsOut(){
  for(let i=0;i<5;i++) ui.lights.children[i].className='light out';
  ui.lights.style.display='none';
}

function updateRace(dt){
  if(race.phase==='grid'){
    race.lightTimer+=dt;
    if(race.lights<5 && race.lightTimer>0.9){ race.lights++; setLights(race.lights); race.lightTimer=0; }
    if(player.speed>4 && !player.jumpStart){
      player.jumpStart=true;
      flashMsg('JUMP START','起步后将罚停 2.5s');
    }
    if(race.lights>=5 && race.lightTimer>(race.lightsOutDelay!=null ? race.lightsOutDelay : rand(0.7,2.6))){
      lightsOut();
      race.phase='racing';
      raceClock=0;
      for(const c of cars){ c.curSectorStart=0; c.lapStart=0; }
      if(player.jumpStart) player.holdTimer=2.5;
      flashMsg('GO!','比赛开始');
    }
  }
  if(race.phase==='racing'){ raceClock+=dt; }
}

// ============================================================
//  HUD
// ============================================================
const LED_N=12;
(function buildRpmLeds(){ if(!ui.rpmBar)return; for(let i=0;i<LED_N;i++){const d=document.createElement('div');d.className='led';ui.rpmBar.appendChild(d);} })();
function fmt(t){ if(t==null||!isFinite(t))return'--:--'; const m=Math.floor(t/60),s=t-m*60; return m+':'+(s<10?'0':'')+s.toFixed(2); }

function flashSector(idx,color){
  const el=[ui.s1,ui.s2,ui.s3][idx];
  el.classList.remove('purple','green','yellow');
  el.classList.add(color);
}
function renderSectorUI(){
  [0,1,2].forEach(i=>{
    const el=[ui.s1,ui.s2,ui.s3][i];
    // 优先显示当前圈, 否则显示上一圈
    const t = player.sectorTimes[i] ?? player.lastSectorTimes[i];
    el.querySelector('.stime').textContent=fmt(t);
    el.classList.remove('purple','green','yellow');
    if(t!=null){
      const b=player.bestSector[i];
      if(b!=null && t<=b) el.classList.add('green');
      else el.classList.add('yellow');
    }
  });
}
let msgTimer=0;
function flashMsg(m1,m2){ ui.msg.style.display='block'; ui.msg1.textContent=m1; ui.msg2.textContent=m2; msgTimer=2.2; }

// ===== 位置变化追踪 =====
let prevPos=1, posNotifyTimer=0;
function checkPositionChange(){
  const ranked=[...cars].sort((a,b)=>rankProgress(b)-rankProgress(a));
  const curPos=ranked.indexOf(player)+1;
  if(curPos!==prevPos && race.phase==='racing'){
    const diff=prevPos-curPos;
    if(diff>0){
      // 超车
      ui.posNotify.textContent='OVERTAKE +'+diff;
      ui.posNotify.className='gp show overtake';
    } else {
      // 被超车
      ui.posNotify.textContent='POSITION '+diff;
      ui.posNotify.className='gp show lost';
    }
    posNotifyTimer=2.0;
    prevPos=curPos;
  }
  if(posNotifyTimer>0){
    posNotifyTimer-=1/60;
    if(posNotifyTimer<=0) ui.posNotify.classList.remove('show');
  }
}

// ===== 车间距计算 =====
function updateGapDisplay(){
  if(race.phase!=='racing'){ 
    if(ui.gapAheadVal) ui.gapAheadVal.textContent='--';
    if(ui.gapBehindVal) ui.gapBehindVal.textContent='--';
    return;
  }
  const ranked=[...cars].sort((a,b)=>rankProgress(b)-rankProgress(a));
  const myIdx=ranked.indexOf(player);
  // 前车
  if(myIdx>0){
    const ahead=ranked[myIdx-1];
    const gap=rankProgress(ahead)-rankProgress(player);
    // 转换为时间 (用最低速度 20 m/s 防止除零)
    const refSpeed=Math.max(Math.abs(player.speed), 20);
    const gapTime=Math.max(0.1, gap/1000*90/refSpeed);
    ui.gapAheadVal.textContent='+'+gapTime.toFixed(1)+'s';
    // 判断是否在追赶 (gap在缩小)
    const prevGap=player._prevGapAhead ?? gap;
    if(gap<prevGap) ui.gapAheadVal.className='fast';
    else if(gap>prevGap) ui.gapAheadVal.className='slow';
    else ui.gapAheadVal.className='';
    player._prevGapAhead=gap;
  } else {
    ui.gapAheadVal.textContent='LEADER';
    ui.gapAheadVal.className='';
  }
  // 后车
  if(myIdx<ranked.length-1){
    const behind=ranked[myIdx+1];
    const gap=rankProgress(player)-rankProgress(behind);
    const refSpeed2=Math.max(Math.abs(player.speed), 20);
    const gapTime=Math.max(0.1, gap/1000*90/refSpeed2);
    ui.gapBehindVal.textContent='+'+gapTime.toFixed(1)+'s';
    const prevGap=player._prevGapBehind ?? gap;
    if(gap>prevGap) ui.gapBehindVal.className='slow'; // 差距在拉大=安全
    else if(gap<prevGap) ui.gapBehindVal.className='fast'; // 差距在缩小=危险
    else ui.gapBehindVal.className='';
    player._prevGapBehind=gap;
  } else {
    ui.gapBehindVal.textContent='LAST';
    ui.gapBehindVal.className='';
  }
}

// ===== HUD 警告系统 =====
function updateWarnings(){
  const c=player;
  // 轮胎警告 (视觉磨损 + 圈数衰减)
  if(ui.tireRow){
    ui.tireRow.classList.remove('warn-danger','warn-warn');
    if(c.tireDegraded || c.tire<10) ui.tireRow.classList.add('warn-danger');
    else if(c.tire<25) ui.tireRow.classList.add('warn-warn');
  }
  // 燃油警告
  if(ui.fuelRow){
    ui.fuelRow.classList.remove('warn-danger','warn-warn');
    if(c.fuel<5) ui.fuelRow.classList.add('warn-danger');
    else if(c.fuel<15) ui.fuelRow.classList.add('warn-warn');
  }
  // 速度警告 (接近弯道时速度过高)
  if(ui.speedo){
    const kph=c.speed*3.2;
    // 检查前方弯道曲率
    const lookAhead=Math.min(30, Math.floor(c.speed*0.8));
    const futureIdx=(c.sampleIdx+lookAhead)%NSAMP;
    const ahead=TANGENTS[futureIdx];
    const cur=TANGENTS[c.sampleIdx];
    const curveDot=ahead.x*cur.x+ahead.z*cur.z;
    const isCorner=curveDot<0.95; // 前方有弯道
    const tooFast=isCorner && kph>180;
    ui.speedo.classList.toggle('speedWarn', tooFast);
  }
}

// ===== 速度模糊效果 =====
function updateSpeedBlur(){
  if(!ui.speedBlur) return;
  const kph=player.speed*3.2;
  // 200 km/h 开始模糊, 300 km/h 最大
  const blurAmount=THREE.MathUtils.clamp((kph-200)/100, 0, 1);
  ui.speedBlur.style.opacity=blurAmount*0.6;
}

function updateHUD(dt){
  if(!player) return;
  const c=player;
  ui.lapBig.textContent=Math.min(c.lap+1,totalLaps);
  const ranked=[...cars].sort((a,b)=>rankProgress(b)-rankProgress(a));
  const pos=ranked.indexOf(c)+1;
  ui.posBig.textContent='P'+pos;
  const kph=Math.round(Math.abs(c.speed)*3.2);
  ui.speedo.textContent=kph;
  ui.gear.textContent=c.inReverse ? 'R' : c.gear;
  // ===== RPM 填充条 + LED + 数值 =====
  const ratio=THREE.MathUtils.clamp(c.rpm/15000,0,1);
  if(ui.rpmFill) ui.rpmFill.style.width=(ratio*100)+'%';
  if(ui.rpmVal) ui.rpmVal.textContent=Math.round(c.rpm);
  const onn=Math.round(ratio*LED_N);
  if(ui.rpmBar){
    for(let i=0;i<LED_N;i++){
      const led=ui.rpmBar.children[i];
      if(!led) continue;
      led.className='led';
      if(i<onn) led.className='led on '+(i<6?'g':i<10?'y':'r');
    }
  }
  // ===== 方向盘指示 (左转→左, 右转→右) =====
  if(ui.steerDot) ui.steerDot.style.left=(50-input.steer*45)+'%';
  // ===== G力指示 (纵向: 加速+, 制动-) =====
  const prevSp=c.prevSpeed ?? c.speed;
  const dv=c.speed-prevSp;
  // game speed → m/s: kph=speed*3.2, m/s=kph/3.6=speed*0.889
  const safeDt=Math.max(dt,0.001);
  const accel_mps2=(dv/safeDt)*0.889;
  const gForce=THREE.MathUtils.clamp(accel_mps2/9.81,-5,5);
  c.prevSpeed=c.speed;
  if(ui.gDot) ui.gDot.style.left=(50+gForce*15)+'%';
  if(ui.gVal) ui.gVal.textContent=(gForce>=0?'+':'')+gForce.toFixed(1)+'G';
  // ===== 轮胎/ERS/燃油 =====
  ui.tireFill.style.width=c.tire+'%'; ui.tireVal.textContent=Math.round(c.tire)+'%';
  // 轮胎类型标记 + 磨损圈数
  const typeBadge = $('tireTypeBadge');
  if(typeBadge){
    // 真实配方色: S=红, H=白底黑字
    typeBadge.textContent = c.tireType==='soft'?'S':'H';
    if(c.tireType==='soft'){ typeBadge.style.background='#e10600'; typeBadge.style.color='#fff'; }
    else { typeBadge.style.background='#f5f5f5'; typeBadge.style.color='#15151e'; }
  }
  const wearVal = $('tireWearVal');
  if(wearVal){
    wearVal.textContent = c.tireWearLaps + '/' + c.tireMaxLaps + ' 圈';
    wearVal.style.color = c.tireDegraded ? '#ef4444' : '#e2e8f0';
  }
  ui.ersFill.style.width=c.ers+'%'; ui.ersVal.textContent=Math.round(c.ers)+'%';
  ui.fuelFill.style.width=c.fuel+'%'; ui.fuelVal.textContent=Math.round(c.fuel)+'%';
  // DRS
  ui.drsBox.classList.remove('avail','active');
  if(c.drsActive) ui.drsBox.classList.add('active');
  else if(c.drsAvailable) ui.drsBox.classList.add('avail');
  // 旗语
  ui.flag.className=''; ui.flag.style.display='none';
  if(raceClock<race.yellowUntil){ ui.flag.textContent='\u2691'; ui.flag.className='yellow'; }
  else if(c.finished){ ui.flag.textContent='\uD83C\uDFC1'; ui.flag.className='check'; }
  // 车队/车手信息
  if(ui.driverInfo && c.team) ui.driverInfo.textContent=c.name+' \u00b7 '+c.teamName+' #'+c.num;
  // 相机模式
  if(ui.camMode) ui.camMode.textContent=camMode===1?'COCKPIT':'CHASE';
  // ===== 当前圈时间 =====
  if(ui.lapTimer && race.phase==='racing'){
    const curLapTime = raceClock - c.lapStartTime;
    ui.lapTimer.textContent = fmt(curLapTime);
  }
  // ===== Delta 时间 (与最佳圈速对比) =====
  if(ui.deltaTime && race.phase==='racing' && c.bestLap!=null){
    const curLapTime = raceClock - c.lapStartTime;
    // 估算当前圈对应位置的最佳圈速
    const expectedFraction = c.progress;
    const expectedTime = c.bestLap * expectedFraction;
    const delta = curLapTime - expectedTime;
    if(Math.abs(delta) < 30){ // 合理范围内才显示
      const sign = delta > 0 ? '+' : '';
      const color = delta > 0.3 ? 'var(--danger)' : delta < -0.3 ? 'var(--green)' : 'var(--muted)';
      ui.deltaTime.textContent = sign + delta.toFixed(2) + 's';
      ui.deltaTime.style.color = color;
    } else {
      ui.deltaTime.textContent = '';
    }
  } else if(ui.deltaTime) {
    ui.deltaTime.textContent = '';
  }
}

function rankProgress(c){
  if(c.finished) return 1e7 - c.finishTime;
  return c.lap*1000 + c.progress*1000;
}

// ============================================================
//  小地图
// ============================================================
const mctx=ui.minimap.getContext('2d');
let miniBounds=null;
(function calcMiniBounds(){
  let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;
  for(const s of SAMPLES){ minx=Math.min(minx,s.x);maxx=Math.max(maxx,s.x);minz=Math.min(minz,s.z);maxz=Math.max(maxz,s.z); }
  miniBounds={minx,maxx,minz,maxz};
})();
function drawMinimap(){
  const W=150,H=150;
  mctx.clearRect(0,0,W,H);
  mctx.fillStyle='rgba(10,14,30,.85)'; mctx.fillRect(0,0,W,H);
  const b=miniBounds, pad=14;
  const sx=(W-2*pad)/(b.maxx-b.minx), sz=(H-2*pad)/(b.maxz-b.minz);
  const s=Math.min(sx,sz);
  const ox=pad+(W-2*pad-(b.maxx-b.minx)*s)/2 - b.minx*s;
  const oy=pad+(H-2*pad-(b.maxz-b.minz)*s)/2 - b.minz*s;
  mctx.strokeStyle='#4a6a9a'; mctx.lineWidth=4; mctx.beginPath();
  for(let i=0;i<=NSAMP;i++){const p=SAMPLES[i%NSAMP]; const x=p.x*s+ox,y=p.z*s+oy; if(i===0)mctx.moveTo(x,y);else mctx.lineTo(x,y);}
  mctx.stroke();
  const p0=SAMPLES[0];
  mctx.fillStyle='#fff'; mctx.fillRect(p0.x*s+ox-2,p0.z*s+oy-2,4,4);
  for(const c of cars){
    const x=c.pos.x*s+ox, y=c.pos.z*s+oy;
    mctx.beginPath(); mctx.arc(x,y,c.isPlayer?4.5:3.5,0,7);
    const hex='#'+(c.team?c.team.color:0x888888).toString(16).padStart(6,'0');
    mctx.fillStyle=hex; mctx.fill();
    if(c.isPlayer){ mctx.strokeStyle='#fff'; mctx.lineWidth=2; mctx.stroke(); }
  }
}

// ============================================================
//  输入
// ============================================================
addEventListener('keydown',e=>{
  const k=e.code;
  if(['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','KeyE','KeyQ','KeyP','KeyC','KeyR','Space'].includes(k)) e.preventDefault();
  if(k==='KeyW'||k==='ArrowUp') input.acc=true;
  if(k==='KeyS'||k==='ArrowDown') input.brake=true;
  if(k==='KeyA'||k==='ArrowLeft') input.steerLeft=true;
  if(k==='KeyD'||k==='ArrowRight') input.steerRight=true;
  if(k==='ShiftLeft'||k==='ShiftRight') input.ers=true;
  if(k==='KeyE') input.drs=true;
  if(k==='KeyC'){ toggleCam(); }
  if(k==='KeyP'){ if(race.phase==='racing'){race.phase='paused';ui.pauseScreen.classList.remove('hidden');} else if(race.phase==='paused'){race.phase='racing';ui.pauseScreen.classList.add('hidden');} }
  if(k==='KeyQ' && race.phase==='racing' && player.pitTimer<=0 && !pitGame.active) tryPit();
  // 换胎小游戏按键处理
  if(pitGame.active) handlePitGameKey(k);
  if(k==='KeyR' && race.phase==='racing') resetPlayerToTrack();
});
addEventListener('keyup',e=>{
  const k=e.code;
  if(k==='KeyW'||k==='ArrowUp') input.acc=false;
  if(k==='KeyS'||k==='ArrowDown') input.brake=false;
  if(k==='KeyA'||k==='ArrowLeft') input.steerLeft=false;
  if(k==='KeyD'||k==='ArrowRight') input.steerRight=false;
  if(k==='ShiftLeft'||k==='ShiftRight') input.ers=false;
  if(k==='KeyE') input.drs=false;
});
const bindTouch=(id,on,off)=>{ const el=$(id); if(!el)return; el.addEventListener('touchstart',e=>{e.preventDefault();on();},{passive:false}); el.addEventListener('touchend',e=>{e.preventDefault();off();},{passive:false}); };
bindTouch('tAcc',()=>input.acc=true,()=>input.acc=false);
bindTouch('tBrk',()=>input.brake=true,()=>input.brake=false);
bindTouch('tL',()=>input.steerLeft=true,()=>input.steerLeft=false);
bindTouch('tR',()=>input.steerRight=true,()=>input.steerRight=false);

// === 换胎拼接小游戏 ===
const pitGame = {
  active: false,
  sequence: [],     // 目标字母序列
  currentIdx: 0,    // 当前需按的字母索引
  timeLimit: 3.0,   // 时间限制 (秒) — 3 字母更短, 时限收紧
  timeLeft: 0,      // 剩余时间
  failCount: 0,     // 连续失败次数
  maxFails: 5,      // 连续失败上限 → 强制完成
};

function generatePitSequence(){
  // 友好字母池 (避免 X/Z/Q 等难定位字母)
  const pool = 'ASDFGHJKLWERTYUIOPCVBNM';
  const len = 3; // 固定 3 个字母, 简洁快速
  const seq = [];
  let last = '';
  for(let i=0; i<len; i++){
    let ch;
    do { ch = pool[Math.floor(Math.random()*pool.length)]; } while(ch === last);
    seq.push(ch);
    last = ch;
  }
  return seq;
}

function startPitMiniGame(){
  pitGame.active = true;
  pitGame.sequence = generatePitSequence();
  pitGame.currentIdx = 0;
  pitGame.timeLeft = pitGame.timeLimit;
  pitGame.failCount = 0;
  player.speed = 0;
  updatePitGameUI();
  const el = $('pitGamePanel');
  if(el) el.style.display = 'flex';
}

function updatePitGameUI(){
  const panel = $('pitGamePanel');
  if(!panel) return;
  const letters = $('pitGameLetters');
  const timer = $('pitGameTimer');
  if(!letters || !timer) return;
  // 渲染字母
  let html = '';
  for(let i=0; i<pitGame.sequence.length; i++){
    const ch = pitGame.sequence[i];
    let cls = 'pit-letter';
    if(i < pitGame.currentIdx) cls += ' done';
    else if(i === pitGame.currentIdx) cls += ' current';
    html += `<span class="${cls}">${ch}</span>`;
  }
  letters.innerHTML = html;
  // 倒计时条
  const pct = Math.max(0, pitGame.timeLeft / pitGame.timeLimit * 100);
  timer.style.width = pct + '%';
  timer.style.background = pct > 40 ? '#00e5ff' : pct > 20 ? '#fbbf24' : '#ef4444';
}

function handlePitGameKey(code){
  if(!pitGame.active) return false;
  // 将 KeyA→A, KeyB→B 等转换
  const match = code.match(/^Key(.)$/);
  if(!match) return false;
  const pressed = match[1];
  const expected = pitGame.sequence[pitGame.currentIdx];
  if(pressed === expected){
    pitGame.currentIdx++;
    if(pitGame.currentIdx >= pitGame.sequence.length){
      // 成功! 完成换胎
      completePitStop();
      return true;
    }
    updatePitGameUI();
  } else {
    // 按错 → 闪红 + 重新生成
    pitGame.failCount++;
    const panel = $('pitGamePanel');
    if(panel){ panel.classList.add('pit-fail'); setTimeout(()=>panel.classList.remove('pit-fail'), 300); }
    if(pitGame.failCount >= pitGame.maxFails){
      // 连续失败上限 → 强制完成 (加罚时)
      completePitStop(true);
    } else {
      // 重新生成序列
      pitGame.sequence = generatePitSequence();
      pitGame.currentIdx = 0;
      pitGame.timeLeft = pitGame.timeLimit;
      updatePitGameUI();
    }
  }
  return true;
}

function completePitStop(penalized){
  pitGame.active = false;
  const el = $('pitGamePanel');
  if(el) el.style.display = 'none';
  player.pits++;
  player.tire = 100;
  // 保留玩家选择的轮胎类型, 不硬编码为 'S'
  player.tireCompound = player.tireType === 'soft' ? 'S' : 'H';
  player.tireWearLaps = 0;
  player.tireDegraded = false;
  player.tireSpeedMult = 1.0;
  player.tireGripMult = 1.0;
  player.tireBlowoutTriggered = false;
  const tireName = player.tireType === 'soft' ? '软胎' : '硬胎';
  if(penalized){
    player.holdTimer = 3.0; // 3秒罚时
    flashMsg('PIT DONE','换胎完成 (罚时3秒)');
  } else {
    flashMsg('PIT DONE','新胎 · ' + tireName);
  }
}

function updatePitMiniGame(dt){
  if(!pitGame.active) return;
  pitGame.timeLeft -= dt;
  if(pitGame.timeLeft <= 0){
    // 超时 → 重新生成
    pitGame.failCount++;
    if(pitGame.failCount >= pitGame.maxFails){
      completePitStop(true);
    } else {
      pitGame.sequence = generatePitSequence();
      pitGame.currentIdx = 0;
      pitGame.timeLeft = pitGame.timeLimit;
      const panel = $('pitGamePanel');
      if(panel){ panel.classList.add('pit-fail'); setTimeout(()=>panel.classList.remove('pit-fail'), 300); }
    }
  }
  updatePitGameUI();
}

function tryPit(){
  const c=player;
  if(c.inReverse){ flashMsg('NO PIT','倒车中无法进站'); return; }
  const inPit = (c.progress>0.925 || c.progress<0.075);
  if(!inPit){ flashMsg('NO PIT','需在主直道进站'); return; }
  if(pitGame.active) return;
  startPitMiniGame();
}

// 重置玩家到赛道中心 (R键)
function resetPlayerToTrack(){
  const c=player;
  const near=nearestSample(c.pos);
  // nearestSample 返回 {idx, dist}, 无 t 属性; 用 idx/NSAMP 推导参数
  const t = near.idx / NSAMP;
  const p = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t);
  c.pos.copy(p); c.pos.y=0.6;
  c.heading = Math.atan2(tangent.x, tangent.z);
  c.velocity.set(0,0,0);
  c.speed=0;
  c.angularVel=0; c.collisionSpin=0; c.collisionLock=0;
  c.inReverse=false;
  c.reverseTimer=0;
  c.crashTimer=0;
  flashMsg('RESET','车辆已重置 · 罚时3秒');
  raceClock+=3; // 重置罚时
}

// 计算与前车的时间差 (秒), 返回 {ahead: car|null, gapSeconds: number}
function getGapToAhead(c){
  const ranked=[...cars].sort((a,b)=>rankProgress(b)-rankProgress(a));
  const myIdx=ranked.indexOf(c);
  if(myIdx<=0) return {ahead:null, gapSeconds:999};
  const ahead=ranked[myIdx-1];
  const gapProg = rankProgress(ahead) - rankProgress(c);
  // 转换为时间: progress差 / 1000 * 一圈参考秒数
  const refSpeed = Math.max(c.speed, 20);
  const gapSeconds = Math.max(0.1, gapProg / 1000 * 90 / refSpeed * 1000 / 1000);
  // 简化: gapProg/1000 = 圈数差, 乘以一圈参考时间(90秒)再按速度修正
  const lapRefTime = 90;
  const speedFactor = 60 / refSpeed; // 以60m/s为基准
  return {ahead, gapSeconds: gapProg/1000 * lapRefTime * speedFactor};
}

// ============================================================
//  DRS 可用判定
// ============================================================
function updateDRS(){
  const c=player;
  c.drsAvailable=false;
  if(race.phase!=='racing'||c.pitTimer>0) return;
  // 检查是否在DRS区域
  let inZone=false;
  for(const [a,b] of DRS_ZONES){
    let prog=c.progress;
    if(a>b){ if(prog>=a||prog<=b) inZone=true; }
    else { if(prog>=a&&prog<=b) inZone=true; }
  }
  if(!inZone) return;
  // 检查跟车条件: 前车在1秒以内 (真实F1规则)
  const gap=getGapToAhead(c);
  if(gap.gapSeconds <= 1.2){
    c.drsAvailable=true;
  }
}

// ============================================================
//  结束
// ============================================================
function endRace(){
  const ranked=[...cars].sort((a,b)=>rankProgress(b)-rankProgress(a));
  const pos=ranked.indexOf(player)+1;
  ui.finalScore.textContent='P'+pos;
  ui.bestLap.textContent=fmt(player.bestLap);
  ui.topSpeed.textContent=Math.round(maxKph)+'km/h';
  ui.pitCount.textContent=player.pits;
  ui.overSub.textContent = pos===1?`${player.name} · ${player.teamName} · 夜赛冠军！`:`${player.name} · ${player.teamName} · 最终成绩`;
  ui.overScreen.classList.remove('hidden');
  race.phase='over';
  // 联机: 上报完赛, 由房主汇总最终名次表 (lobby.js)
  if(typeof window.onLocalFinish==='function'){
    window.onLocalFinish({ time: player.finishTime || raceClock });
  }
}
let maxKph=0;

// ============================================================
//  音效系统 (Web Audio API) — 引擎/风噪/轮胎啸叫/碰撞
//  引擎: 锯齿+方波失谐+次谐波正弦 → 低通 → 压缩器 (F1 高转尖叫+低转厚重)
// ============================================================
let audioCtx=null, audioInitialized=false, audioMaster=null;
let engOsc1=null, engOsc2=null, engSub=null, engFilter=null, engGain=null;
let windSrc=null, windFilter=null, windGain=null;
let tireSrc=null, tireFilter=null, tireGain=null;
let crackleTimer=0;

function makeNoiseBuffer(ctx, seconds){
  const buf=ctx.createBuffer(1, Math.floor(ctx.sampleRate*seconds), ctx.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  return buf;
}

function initAudio(){
  if(audioInitialized) return;
  try{
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    // 主压缩器: 粘合各声部, 防止削波
    audioMaster=audioCtx.createDynamicsCompressor();
    audioMaster.threshold.value=-18;
    audioMaster.ratio.value=4;
    audioMaster.connect(audioCtx.destination);

    // === 引擎: 三声部 → 低通 → 增益 → 压缩器 ===
    engFilter=audioCtx.createBiquadFilter();
    engFilter.type='lowpass'; engFilter.frequency.value=400; engFilter.Q.value=2.5;
    engGain=audioCtx.createGain(); engGain.gain.value=0;
    engFilter.connect(engGain); engGain.connect(audioMaster);
    // 基频 (锯齿)
    engOsc1=audioCtx.createOscillator(); engOsc1.type='sawtooth'; engOsc1.frequency.value=80;
    // 二次谐波 (方波, 失谐, 增加厚度)
    engOsc2=audioCtx.createOscillator(); engOsc2.type='square'; engOsc2.frequency.value=160;
    const g2=audioCtx.createGain(); g2.gain.value=0.35;
    // 次谐波 (正弦, 低频重量感)
    engSub=audioCtx.createOscillator(); engSub.type='sine'; engSub.frequency.value=40;
    const gSub=audioCtx.createGain(); gSub.gain.value=0.55;
    engOsc1.connect(engFilter);
    engOsc2.connect(g2); g2.connect(engFilter);
    engSub.connect(gSub); gSub.connect(engFilter);
    engOsc1.start(); engOsc2.start(); engSub.start();

    // === 风噪: 循环噪声 → 带通 → 增益 (随速度) ===
    windSrc=audioCtx.createBufferSource();
    windSrc.buffer=makeNoiseBuffer(audioCtx, 2); windSrc.loop=true;
    windFilter=audioCtx.createBiquadFilter();
    windFilter.type='bandpass'; windFilter.frequency.value=500; windFilter.Q.value=0.6;
    windGain=audioCtx.createGain(); windGain.gain.value=0;
    windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(audioMaster);
    windSrc.start();

    // === 轮胎啸叫: 噪声 → 带通(随滑移扫频) → 增益 ===
    tireSrc=audioCtx.createBufferSource();
    tireSrc.buffer=makeNoiseBuffer(audioCtx, 2); tireSrc.loop=true;
    tireFilter=audioCtx.createBiquadFilter();
    tireFilter.type='bandpass'; tireFilter.frequency.value=1100; tireFilter.Q.value=6;
    tireGain=audioCtx.createGain(); tireGain.gain.value=0;
    tireSrc.connect(tireFilter); tireFilter.connect(tireGain); tireGain.connect(audioMaster);
    tireSrc.start();

    audioInitialized=true;
  } catch(e){ console.warn('Audio init failed:', e); }
}

// 播放碰撞音效
function playCrashSound(intensity){
  if(!audioInitialized || !audioCtx) return;
  if(!isFinite(intensity)) intensity=0.3; // NaN 防护
  intensity=THREE.MathUtils.clamp(intensity,0,1);
  const now=audioCtx.currentTime;
  // 白噪声 + 低通 = 撞击声
  const bufferSize=audioCtx.sampleRate * 0.15;
  const buffer=audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<bufferSize;i++){
    data[i]=(Math.random()*2-1) * (1 - i/bufferSize); // 衰减包络
  }
  const noise=audioCtx.createBufferSource();
  noise.buffer=buffer;
  const filter=audioCtx.createBiquadFilter();
  filter.type='lowpass';
  filter.frequency.value=300 + intensity*500;
  filter.Q.value=3;
  const gain=audioCtx.createGain();
  gain.gain.value=0.15 + intensity*0.3;
  gain.gain.exponentialRampToValueAtTime(0.001, now+0.15);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioMaster || audioCtx.destination);
  noise.start(now);
  noise.stop(now+0.15);
}

// 收油爆震 (overrun crackle): 高转速松油门时的排气放炮
function playCrackle(vol){
  if(!audioInitialized || !audioCtx) return;
  const t=audioCtx.currentTime;
  const src=audioCtx.createBufferSource();
  src.buffer=windSrc.buffer; // 复用风噪缓冲
  const f=audioCtx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900;
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.06);
  src.connect(f); f.connect(g); g.connect(audioMaster || audioCtx.destination);
  src.start(t, Math.random()*1.5, 0.06);
}

// 更新轮胎啸叫声
function updateTireSound(slipAmount){
  if(!audioInitialized || !audioCtx || !tireGain) return;
  if(!isFinite(slipAmount)) slipAmount=0; // NaN 防护
  const t=audioCtx.currentTime;
  const vol=Math.max(0, Math.min(0.12, slipAmount*0.2));
  tireGain.gain.linearRampToValueAtTime(vol, t+0.05);
  // 啸叫频率随滑移量升高 (900Hz → 1600Hz)
  tireFilter.frequency.linearRampToValueAtTime(900+slipAmount*700, t+0.05);
}

function updateEngineSound(){
  if(!audioInitialized || !audioCtx || !player) return;
  const t=audioCtx.currentTime;
  // 暂停/菜单时全部静音
  if(race.phase!=='racing' && race.phase!=='grid'){
    engGain.gain.linearRampToValueAtTime(0, t+0.1);
    windGain.gain.linearRampToValueAtTime(0, t+0.1);
    tireGain.gain.linearRampToValueAtTime(0, t+0.1);
    return;
  }
  const c=player;
  // NaN 防护: rpm 非法时回退怠速 (防止 linearRamp 抛错)
  let rpm=c.rpm;
  if(!isFinite(rpm)) rpm=3000;
  rpm=THREE.MathUtils.clamp(rpm,0,16000);
  const rn=rpm/15000;
  // 基频: 70Hz(怠速) → 430Hz(红线), 略指数化更像高转机
  const f=70+Math.pow(rn,0.9)*360;
  engOsc1.frequency.linearRampToValueAtTime(f, t+0.05);
  engOsc2.frequency.linearRampToValueAtTime(f*2.02, t+0.05); // 二次谐波失谐
  engSub.frequency.linearRampToValueAtTime(Math.max(30, f*0.5), t+0.05);
  // 滤波器: 随 RPM 和油门负载开放
  engFilter.frequency.linearRampToValueAtTime(250+rn*1800+(input.acc?300:0), t+0.05);
  // 音量: 怠速低沉, 随 RPM+油门增大
  const vol=Math.min(0.05+rn*0.11+(input.acc?0.07:0), 0.23);
  engGain.gain.linearRampToValueAtTime(vol, t+0.05);
  // 风噪 ∝ 速度² (高速呼啸)
  const spd=isFinite(c.speed)?Math.abs(c.speed):0;
  const wvol=Math.min(0.10, (spd/82)*(spd/82)*0.10);
  windGain.gain.linearRampToValueAtTime(wvol, t+0.1);
  windFilter.frequency.linearRampToValueAtTime(400+spd*6, t+0.1);
  // 收油爆震: 高转速松油门随机放炮
  crackleTimer-=1/60;
  if(!input.acc && rpm>9000 && crackleTimer<=0){
    crackleTimer=0.05+Math.random()*0.12;
    playCrackle(0.03+Math.random()*0.05);
  }
}

// 首次交互时初始化音频
document.addEventListener('click', ()=>{ if(!audioInitialized) initAudio(); }, {once:false});
document.addEventListener('keydown', ()=>{ if(!audioInitialized) initAudio(); }, {once:false});

// ============================================================
//  轮胎印系统
// ============================================================
const tireMarks=[];
const MAX_TIRE_MARKS=200;
const tireMarkGeo=new THREE.PlaneGeometry(0.3, 1.2);
const tireMarkMat=new THREE.MeshBasicMaterial({color:0x111111, transparent:true, opacity:0.4, side:THREE.DoubleSide});

function spawnTireMark(pos, heading){
  if(tireMarks.length>=MAX_TIRE_MARKS){
    // 移除最旧的
    const old=tireMarks.shift();
    scene.remove(old);
    old.geometry.dispose();
  }
  const mark=new THREE.Mesh(tireMarkGeo, tireMarkMat.clone());
  mark.position.set(pos.x, 0.03, pos.z);
  mark.rotation.x=-Math.PI/2;
  mark.rotation.z=-heading;
  scene.add(mark);
  tireMarks.push(mark);
}

function updateTireMarks(){
  // 逐渐淡化旧轮胎印
  for(let i=tireMarks.length-1;i>=0;i--){
    const m=tireMarks[i];
    m.material.opacity-=0.001;
    if(m.material.opacity<=0){
      scene.remove(m);
      m.material.dispose();
      tireMarks.splice(i,1);
    }
  }
}

// ============================================================
//  粒子系统 (碰撞火花 + 刹车烟雾)
// ============================================================
const particles = [];
const MAX_PARTICLES = 120; // 增加粒子上限, 支持爆胎特效
const sparkGeo = new THREE.SphereGeometry(0.08, 4, 4);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
const smokeGeo = new THREE.SphereGeometry(0.3, 6, 6);
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.4 });
const debrisGeo = new THREE.BoxGeometry(0.12, 0.06, 0.08);
const debrisMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });

function spawnSparks(pos, count) {
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
    mesh.position.copy(pos);
    mesh.position.y += 0.3;
    scene.add(mesh);
    particles.push({
      mesh, type: 'spark',
      vel: new THREE.Vector3((Math.random()-0.5)*8, Math.random()*6+2, (Math.random()-0.5)*8),
      life: 0.4 + Math.random() * 0.3,
      maxLife: 0.7
    });
  }
}
function spawnSmoke(pos, count) {
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
    mesh.position.copy(pos);
    mesh.position.y += 0.2;
    scene.add(mesh);
    particles.push({
      mesh, type: 'smoke',
      vel: new THREE.Vector3((Math.random()-0.5)*2, Math.random()*1.5+0.5, (Math.random()-0.5)*2),
      life: 0.8 + Math.random() * 0.5,
      maxLife: 1.3
    });
  }
}
function spawnDebris(pos, count) {
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const mesh = new THREE.Mesh(debrisGeo, debrisMat.clone());
    mesh.position.copy(pos);
    mesh.position.y += 0.15;
    mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    scene.add(mesh);
    particles.push({
      mesh, type: 'debris',
      vel: new THREE.Vector3((Math.random()-0.5)*6, Math.random()*4+2, (Math.random()-0.5)*6),
      life: 1.0 + Math.random() * 0.8,
      maxLife: 1.8
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.type === 'spark') {
      p.vel.y -= 15 * dt; // gravity
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = t;
      p.mesh.scale.setScalar(t);
    } else if (p.type === 'debris') {
      p.vel.y -= 12 * dt; // gravity (lighter than sparks)
      if (p.mesh.position.y < 0.06) { p.mesh.position.y = 0.06; p.vel.y = 0; p.vel.x *= 0.9; p.vel.z *= 0.9; }
      p.mesh.rotation.x += 5 * dt;
      p.mesh.rotation.z += 3 * dt;
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = t;
    } else {
      p.vel.multiplyScalar(0.95); // drag
      const t = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(1 + t * 2);
      p.mesh.material.opacity = 0.4 * (1 - t);
    }
  }
}

// ============================================================
//  轮胎特效粒子 (磨损火花 + 爆胎烟雾碎片)
// ============================================================
function updateTireEffects(dt) {
  for (const c of cars) {
    // 爆胎特效: 轮胎到 0% 时触发一次
    if (c.tire <= 0 && !c.tireBlowoutTriggered) {
      c.tireBlowoutTriggered = true;
      spawnSparks(c.pos, 12);
      spawnSmoke(c.pos, 6);
      spawnDebris(c.pos, 3);
    }
    // 爆胎后持续少量火花 + 烟雾
    if (c.tire <= 0 && c.speed > 5) {
      c.tireSparkTimer -= dt;
      if (c.tireSparkTimer <= 0) {
        spawnSparks(c.pos, 2);
        if (Math.random() < 0.3) spawnSmoke(c.pos, 1);
        c.tireSparkTimer = 0.3 + Math.random() * 0.2;
      }
    }
    // 轻微磨损火花: 15% 以下, 高速时偶发
    if (c.tire > 0 && c.tire < 15 && c.speed > 15) {
      c.tireSparkTimer -= dt;
      if (c.tireSparkTimer <= 0) {
        spawnSparks(c.pos, 1);
        c.tireSparkTimer = 0.5 + Math.random() * 0.5;
      }
    }
    // 换胎后重置特效状态
    if (c.tire > 50 && c.tireBlowoutTriggered) {
      c.tireBlowoutTriggered = false;
      c.tireSparkTimer = 0;
    }
  }
}

// ============================================================
//  主循环
// ============================================================
const clock=new THREE.Clock();
// 标签页切换检测: 切出时自动暂停, 防止大dt导致物理爆炸
document.addEventListener('visibilitychange',()=>{
  if(document.hidden && race.phase==='racing'){
    race.phase='paused'; ui.pauseScreen.classList.remove('hidden');
  }
});

// ---------- 联机: 远程车辆插值 ----------
// 网络状态由 lobby.js 写入 c._netPrev/_netNext, 这里做 120ms 延迟插值
function updateRemoteCar(c){
  const a=c._netPrev, b=c._netNext;
  if(!b) return;
  if(!a || b.t<=a.t){
    c.pos.set(b.p[0],b.p[1],b.p[2]);
    c.heading=b.h; c.speed=b.v;
  } else {
    const rt=performance.now()-120;
    const span=Math.max(1, b.t-a.t);
    const k=THREE.MathUtils.clamp((rt-a.t)/span, 0, 1.2);
    c.pos.set(a.p[0]+(b.p[0]-a.p[0])*k, a.p[1]+(b.p[1]-a.p[1])*k, a.p[2]+(b.p[2]-a.p[2])*k);
    let dh=b.h-a.h;
    while(dh>Math.PI)dh-=2*Math.PI;
    while(dh<-Math.PI)dh+=2*Math.PI;
    c.heading=a.h+dh*k;
    c.speed=a.v+(b.v-a.v)*k;
  }
  c.velocity.set(Math.sin(c.heading)*c.speed, 0, Math.cos(c.heading)*c.speed);
  applyMesh(c);
}

function loop(){
  requestAnimationFrame(loop);
  let dt=Math.min(clock.getDelta(),0.05);
  // 健壮性: 如果dt异常大(切回标签页), 限制为安全值
  if(dt>0.05) dt=0.016;
  if(dt<=0) dt=0.001;

  // 摩天轮旋转
  if(scene.userData.flyer && scene.userData.flyer.userData.spin) scene.userData.flyer.userData.spin();

  if(race.phase==='racing'||race.phase==='grid'){
    updateRace(dt);
    updatePlayer(dt);
    for(const c of cars){
      if(c.isRemote){ updateRemoteCar(c); continue; } // 联机: 网络驱动的车不跑AI
      if(!c.isPlayer){
        try{ updateAI(c,dt); }
        catch(e){ console.warn('AI error:', e); }
      }
    }
    if(typeof window.MPraceTick==='function') window.MPraceTick(dt); // 联机状态广播 (20Hz)
    try{ carCollisions(); } catch(e){}
    // 碰撞翻滚动画计时 (纯视觉, 不冻结车辆); AI 翻滚结束后进入恢复模式
    for(const c of cars){
      if(c.crashTimer>0){
        c.crashTimer-=dt;
        if(c.crashTimer<=0){
          c.crashTimer=0; c.crashAngle=0;
          if(!c.isPlayer && !c.isRemote){ c.recoveryMode=true; c.recoveryTimer=1.5; }
        }
      }
    }
    updateDRS();
    maxKph=Math.max(maxKph, player.speed*3.2);
    // 玩家轮胎消耗: 降速以匹配 3-4 圈寿命
    // 基础 0.12/s + 加速 0.08 + 转向 0.06 + 高速 0.04 = 最高约 0.30/s
    // 100% 轮胎可支撑约 5.5 分钟 (3-4 圈), 撞墙额外扣 4 点
    const speedFactor = Math.abs(player.speed) > 50 ? 0.04 : 0;
    player.tire=Math.max(0, player.tire - (0.12 + (input.acc?0.08:0) + Math.abs(input.steer)*0.06 + speedFactor)*dt);
    updatePitMiniGame(dt); // 换胎小游戏倒计时
    if(player.fuel<=0){ player.speed*=0.97; }
    // 玩家位置健壮性检查
    if(player && (isNaN(player.pos.x)||isNaN(player.pos.z)||Math.abs(player.pos.x)>2000||Math.abs(player.pos.z)>2000)){
      resetPlayerToTrack();
      console.warn('Player position invalid, reset to track');
    }
    // 刹车烟雾 (高速急刹时)
    if(input.brake && player.speed>25){
      const behind=player.pos.clone().addScaledVector(new THREE.Vector3(-Math.sin(player.heading),0,-Math.cos(player.heading)),1.5);
      spawnSmoke(behind, 2);
    }
  }
  updateTireEffects(dt);
  updateParticles(dt);
  updateEngineSound();
  // 轮胎啸叫声 (基于滑移量)
  if(player && race.phase==='racing'){
    const velLen=player.velocity.length();
    let slip=0;
    if(velLen>5){
      // 计算速度方向与车头朝向的夹角 (滑移角)
      const headingDir=new THREE.Vector3(Math.sin(player.heading),0,Math.cos(player.heading));
      const velNorm=player.velocity.clone().normalize();
      const dot=THREE.MathUtils.clamp(headingDir.dot(velNorm),-1,1);
      const slipAngle=Math.acos(dot);
      // 滑移角超过0.1弧度开始有啸叫声
      slip=Math.max(0, slipAngle-0.08)*8;
      // 刹车时也有啸叫声
      if(input.brake && player.speed>20) slip=Math.max(slip, 0.8);
    }
    updateTireSound(slip);
  }
  updateTireMarks();
  // 对手标记脉冲动画 (环 + 光柱 + 箭头)
  for(const c of cars){
    if(c.marker){
      const pulse=0.5+0.5*Math.sin(raceClock*4);
      c.marker.material.opacity=0.5+pulse*0.4;
      if(c.marker.userData.glow){
        c.marker.userData.glow.material.opacity=0.15+pulse*0.25;
        c.marker.userData.glow.scale.setScalar(1+pulse*0.2);
      }
      if(c.marker.userData.beam){
        c.marker.userData.beam.material.opacity=0.1+pulse*0.15;
        c.marker.userData.beam.scale.y=0.9+pulse*0.15;
      }
      if(c.marker.userData.arrow){
        c.marker.userData.arrow.material.opacity=0.3+pulse*0.4;
        c.marker.userData.arrow.position.y=2.1+Math.sin(raceClock*6)*0.2;
      }
    }
  }
  // 轮胎印 (急刹或高速转向时)
  if(player && race.phase==='racing'){
    const kph=player.speed*3.2;
    const isBraking=input.brake && kph>80;
    const isDrifting=Math.abs(input.steer)>0.5 && kph>120;
    if(isBraking || isDrifting){
      const behind=player.pos.clone().addScaledVector(
        new THREE.Vector3(-Math.sin(player.heading),0,-Math.cos(player.heading)), 1.2
      );
      spawnTireMark(behind, player.heading);
    }
  }
  updateCamera(dt);
  updateHUD(dt);
  checkPositionChange();
  updateGapDisplay();
  updateWarnings();
  updateSpeedBlur();
  drawMinimap();
  if(msgTimer>0){ msgTimer-=dt; if(msgTimer<=0) ui.msg.style.display='none'; }
  renderer.render(scene,camera);
}
function carCollisions(){
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
    const a=cars[i],b=cars[j];
    // 宽相剔除: 车体对角线 ~3.1m, 两车最远距离 6.2m
    const dx=b.pos.x-a.pos.x, dz=b.pos.z-a.pos.z;
    if(dx*dx+dz*dz > 6.2*6.2) continue;
    // 进站车辆不参与碰撞
    if(a.pitting || b.pitting) continue;
    // 窄相: OBB vs OBB (SAT)
    const contact = Physics2D.obbContact(a, b);
    if(!contact) continue;
    // 双刚体冲量求解 (远程车为运动学刚体: 不被推离网络插值)
    const res = Physics2D.carCarResolve(a, b, contact);
    // speed 同步: 前向投影 (远程车速度由网络决定, 不覆盖)
    for(const c of [a,b]){
      if(c.isRemote) continue;
      const fx=Math.sin(c.heading), fz=Math.cos(c.heading);
      c.speed = c.velocity.x*fx + c.velocity.z*fz;
    }
    if(!res) continue; // 已在分离, 仅位置修正
    const sev = Math.abs(res.vn); // 法向接近速度 (真实物理量)
    if(sev < 1.5) continue;

    // 碰撞锁定: 让冲量结果积分 (本地车)
    const lockT = 0.05 + Math.min(0.07, sev*0.0012);
    for(const c of [a,b]){
      if(c.isRemote) continue;
      c.collisionLock = Math.max(c.collisionLock, lockT);
      c.collisionVel.copy(c.velocity);
      c.collisionSpin = c.angularVel;
    }
    // AI 行为兼容: 显著撞击后短暂进入保守速度 (updateAI 读取)
    if(sev>6){ a.collisionCooldown=0.5; b.collisionCooldown=0.5; }

    // 效果节流: 每对车 0.25s 只触发一次
    a._pairFx = a._pairFx || {};
    if(a._pairFx[j] != null && raceClock - a._pairFx[j] < 0.25) continue;
    a._pairFx[j] = raceClock;

    // 轮胎损耗 (烈度相关)
    const tireHit = sev > 20 ? 5 : sev > 8 ? 3 : 1;
    a.tire = Math.max(0, a.tire - tireHit);
    b.tire = Math.max(0, b.tire - tireHit);
    // 悬挂冲击 (重力感)
    if(a._sus && sev > 3) a._sus.yV = Math.min(a._sus.yV, -sev * 0.02);
    if(b._sus && sev > 3) b._sus.yV = Math.min(b._sus.yV, -sev * 0.02);

    // 高速重撞: 翻滚动画, 方向跟随偏航
    if(sev>22){
      if(a.crashTimer<=0){ a.crashTimer=0.3; a.crashAngle=(Math.sign(a.angularVel)||1)*(0.3+Math.random()*0.2); }
      if(b.crashTimer<=0){ b.crashTimer=0.3; b.crashAngle=(Math.sign(b.angularVel)||-1)*(0.3+Math.random()*0.2); }
    }

    // 火花/烟雾
    const mid=new THREE.Vector3((a.pos.x+b.pos.x)/2, 0.4, (a.pos.z+b.pos.z)/2);
    const sevK=THREE.MathUtils.clamp(sev/25, 0, 1);
    spawnSparks(mid, Math.floor(3+sevK*12));
    if(sevK>0.35) spawnSmoke(mid, Math.floor(3+sevK*8));

    // 音效 + 震动
    if(sev>4){
      const vol=THREE.MathUtils.clamp(sev/35, 0.08, 1);
      if(a.isPlayer||b.isPlayer){
        camShake=Math.max(camShake, Math.min(1, sev/45));
        playCrashSound(vol);
        if(sev>15) flashMsg('CONTACT','碰撞 · '+(sev*3.6|0)+'km/h');
      }
    }
  }
}

// ---------- resize ----------
addEventListener('resize',()=>{
  renderer.setSize(innerWidth,innerHeight);
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
});

// ---------- buttons ----------
// startBtn 由 lobby.js 绑定 (单人练习 → 选赛道)
$('retryBtn').addEventListener('click', ()=>{
  // 联机比赛结束后返回大厅 (由 lobby.js 设置)
  if(window.onRaceRetry){ window.onRaceRetry(); return; }
  openGarage();
});
$('resumeBtn').addEventListener('click',()=>{ race.phase='racing'; ui.pauseScreen.classList.add('hidden'); });
// 第一/第三人称切换按钮
function toggleCam(){
  camMode=1-camMode;
  ui.camMode.textContent = camMode===1?'COCKPIT':'CHASE';
  flashMsg(camMode===1?'COCKPIT':'CHASE', camMode===1?'第一人称视角':'第三人称视角');
}
$('camBtn').addEventListener('click',toggleCam);

// 启动渲染（菜单时也渲染场景预览）
(()=>{
  const c=makeCar(true,0); c.mesh.userData.isCar=true; player=c;
  ui.camMode.textContent='CHASE';
  camPos.copy(c.pos).add(new THREE.Vector3(-7,2.8,0));
  camera.position.copy(camPos);
  const fwd=new THREE.Vector3(Math.sin(c.heading),0,Math.cos(c.heading));
  camera.lookAt(c.pos.clone().addScaledVector(fwd,10));
})();
loop();
window.__gameOK=true; // 标记游戏加载成功
