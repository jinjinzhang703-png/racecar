// ============================================================
//  Physics2D — 2D 刚体碰撞物理 (俯视平面: x 横向, z 纵向)
//
//  参考真实 F1 赛车数据:
//    车重      798 kg        (2024 规则最低车重, 含车手)
//    全宽      2.0 m         (规则上限)
//    全长      ~5.6 m        (轴距 ≤3.6m)
//    偏航惯量  ~2600 kg·m²   (按 I = m/12·(w²+l²) 估算)
//    护墙      TECPRO/轮胎墙为高吸能屏障: 恢复系数 0.03~0.10,
//              切向摩擦 μ≈0.35 (轮胎-护墙刮擦)
//    车对车    碳纤维单体壳破碎吸能: 恢复系数 ~0.15, 摩擦 μ≈0.40
//
//  碰撞模型: 单点接触冲量 (含偏航力矩) + Baumgarte 位置修正
//    Jn = -(1+e)·vn / (ΣinvM + (r×n)²·invI)   — 法向冲量
//    Jt = clamp(-vt/kT, ±μ·Jn)                — 库仑摩擦冲量
//    Δω = (r × J) · invI                      — 撞击点偏离质心产生打转
//
//  游戏内车辆实体 (game.js 的 car 对象) 直接作为刚体使用:
//    pos:Vector3, velocity:Vector3, heading, angularVel,
//    _invMass / _invInertia (由 game.js 注入; 0 = 运动学刚体,
//    用于网络远程车 — 本地车撞上去自己弹开, 远程车不被推离插值)
// ============================================================
const Physics2D = (function(){
  'use strict';

  // ---- 常量 ----
  const CAR = {
    MASS: 798,
    INV_MASS: 1/798,
    INERTIA: 2600,
    INV_INERTIA: 1/2600,
    HALF_W: 0.93,   // 碰撞盒半宽 (与放大1.5x后的车模/CAR_CORNERS一致, 真实F1宽~1.86m)
    HALF_L: 2.93,   // 碰撞盒半长 (真实F1长~5.85m)
  };
  // 护墙 (TECPRO 吸能屏障)
  const WALL = {
    REST_LOW: 0.10,    // 低速擦碰恢复系数
    REST_HIGH: 0.03,   // 高速重撞恢复系数 (动能主要被护墙/车体吸收)
    SPEED_REF: 25,     // 高低速分界 m/s (≈90 km/h)
    FRICTION: 0.35,    // 切向库仑摩擦系数
  };
  // 车对车
  const CARCAR = {
    RESTITUTION: 0.15, // 恢复系数 (碳纤维破碎吸能, 近非弹性)
    FRICTION: 0.40,    // 车体间摩擦 (侧箱/轮胎互锁)
  };
  const SLOP = 0.01;          // 穿透容差 (m)
  const BETA = 0.8;           // Baumgarte 位置修正比例
  const MAX_CORRECTION = 0.6; // 单帧最大位置修正 (防暴弹跳开)
  const MAX_SPEED = 60;       // 碰撞后速度上限 m/s (≈216 km/h)
  const MAX_OMEGA = 5;        // 角速度上限 rad/s (防无限打转)

  // 2D 叉积标量: r × v = rx·vz - rz·vx
  const cross = (rx,rz,vx,vz) => rx*vz - rz*vx;

  function clampBody(b){
    const sp = Math.hypot(b.velocity.x, b.velocity.z);
    if(sp > MAX_SPEED){
      b.velocity.x *= MAX_SPEED/sp;
      b.velocity.z *= MAX_SPEED/sp;
    }
    if(b.angularVel >  MAX_OMEGA) b.angularVel =  MAX_OMEGA;
    if(b.angularVel < -MAX_OMEGA) b.angularVel = -MAX_OMEGA;
  }

  // 接触点速度: v + ω×r   (ω 为标量, ω×r = (-ω·rz, ω·rx))
  function contactVel(b, rx, rz, out){
    out.x = b.velocity.x - b.angularVel*rz;
    out.z = b.velocity.z + b.angularVel*rx;
    return out;
  }

  // 在点 r 处施加冲量 (jx,jz), 更新线速度与角速度
  // (运动学刚体分量跳过, 消除 Infinity*0=NaN)
  function applyImpulse(b, jx, jz, rx, rz){
    if(b._invMass > 0){
      b.velocity.x += jx * b._invMass;
      b.velocity.z += jz * b._invMass;
    }
    if(b._invInertia > 0){
      b.angularVel += cross(rx,rz,jx,jz) * b._invInertia;
    }
  }

  // ============================================================
  //  墙碰撞: 车角点 vs 护墙
  //  px,pz   接触点 (最深穿透角点, 世界坐标)
  //  nx,nz   墙法线 (指向赛道内侧, 即把车推回赛道的方向)
  //  pen     穿透深度 (m)
  //  返回 { vn, vt } 碰撞前接触点法/切向速度; 已在分离则返回 null
  // ============================================================
  const _v = {x:0, z:0};
  function wallResolve(b, px, pz, nx, nz, pen){
    const rx = px - b.pos.x, rz = pz - b.pos.z;
    contactVel(b, rx, rz, _v);
    const vn = _v.x*nx + _v.z*nz;      // <0 = 正在接近墙
    if(vn >= 0){
      // 已分离: 仅做位置修正防残留穿透
      const corr0 = Math.min(MAX_CORRECTION, Math.max(pen - SLOP, 0) * BETA);
      b.pos.x += nx*corr0; b.pos.z += nz*corr0;
      return null;
    }
    const tx = -nz, tz = nx;           // 切线 (沿墙)
    const vt = _v.x*tx + _v.z*tz;
    const rn = cross(rx,rz,nx,nz);
    const rt = cross(rx,rz,tx,tz);
    const kn = b._invMass + rn*rn*b._invInertia;
    const kt = b._invMass + rt*rt*b._invInertia;

    // 恢复系数随撞击烈度降低 (高速重撞: 能量被护墙+车体吸收)
    const e = Math.abs(vn) > WALL.SPEED_REF ? WALL.REST_HIGH : WALL.REST_LOW;
    const jn = -(1+e)*vn / kn;

    // 库仑摩擦: 最大摩擦冲量受法向冲量限制
    let jt = -vt / kt;
    const maxF = WALL.FRICTION * jn;
    jt = Math.max(-maxF, Math.min(maxF, jt));

    applyImpulse(b, jn*nx + jt*tx, jn*nz + jt*tz, rx, rz);

    // 位置修正 (Baumgarte, 留出 slop 防抖动)
    const corr = Math.min(MAX_CORRECTION, Math.max(pen - SLOP, 0) * BETA);
    b.pos.x += nx*corr; b.pos.z += nz*corr;

    clampBody(b);
    return { vn, vt };
  }

  // ============================================================
  //  车对车: OBB vs OBB (SAT 分离轴 + 单点接触冲量)
  // ============================================================

  // 车体角点 (世界坐标), 旋转规则与 game.js getCarCorners 一致:
  //   wx = lx·cos + lz·sin,  wz = -lx·sin + lz·cos
  function obbCorners(b, out){
    const cos = Math.cos(b.heading), sin = Math.sin(b.heading);
    const hw = CAR.HALF_W, hl = CAR.HALF_L;
    out[0].x = b.pos.x + (-hw)*cos + hl*sin; out[0].z = b.pos.z - (-hw)*sin + hl*cos;
    out[1].x = b.pos.x + ( hw)*cos + hl*sin; out[1].z = b.pos.z - ( hw)*sin + hl*cos;
    out[2].x = b.pos.x + ( hw)*cos - hl*sin; out[2].z = b.pos.z - ( hw)*sin - hl*cos;
    out[3].x = b.pos.x + (-hw)*cos - hl*sin; out[3].z = b.pos.z - (-hw)*sin - hl*cos;
    return out;
  }

  // 点是否在 OBB 内 (含容差 m)
  function pointInOBB(px, pz, b, margin){
    const dx = px - b.pos.x, dz = pz - b.pos.z;
    const cos = Math.cos(b.heading), sin = Math.sin(b.heading);
    const lx = dx*cos - dz*sin;   // 逆旋转 (转置)
    const lz = dx*sin + dz*cos;
    return Math.abs(lx) <= CAR.HALF_W + margin && Math.abs(lz) <= CAR.HALF_L + margin;
  }

  // 在轴 (ax,az) 上投影角点, 返回 [min,max]
  function project(corners, ax, az, out){
    let mn = Infinity, mx = -Infinity;
    for(let i=0;i<4;i++){
      const d = corners[i].x*ax + corners[i].z*az;
      if(d<mn) mn=d; if(d>mx) mx=d;
    }
    out[0]=mn; out[1]=mx;
    return out;
  }

  const _ca = [{x:0,z:0},{x:0,z:0},{x:0,z:0},{x:0,z:0}];
  const _cb = [{x:0,z:0},{x:0,z:0},{x:0,z:0},{x:0,z:0}];
  const _pa = [0,0], _pb = [0,0];

  // SAT 接触检测: 返回 { nx,nz(由a指向b), depth, px,pz(接触点) } 或 null
  function obbContact(a, b){
    obbCorners(a, _ca);
    obbCorners(b, _cb);
    // 4 根分离轴: a/b 各自的横向与纵向
    const cosA = Math.cos(a.heading), sinA = Math.sin(a.heading);
    const cosB = Math.cos(b.heading), sinB = Math.sin(b.heading);
    const axes = [
      cosA, -sinA,   // a 横向 (局部x轴的世界方向)
      sinA,  cosA,   // a 纵向 (车头方向)
      cosB, -sinB,
      sinB,  cosB,
    ];
    let minDepth = Infinity, nAx = 0, nAz = 0;
    for(let i=0;i<8;i+=2){
      const ax = axes[i], az = axes[i+1];
      project(_ca, ax, az, _pa);
      project(_cb, ax, az, _pb);
      const depth = Math.min(_pa[1],_pb[1]) - Math.max(_pa[0],_pb[0]);
      if(depth <= 0) return null;      // 找到分离轴 → 无碰撞
      if(depth < minDepth){
        minDepth = depth;
        // 法线取向: 由 a 指向 b
        const dir = (b.pos.x-a.pos.x)*ax + (b.pos.z-a.pos.z)*az;
        nAx = dir >= 0 ? ax : -ax;
        nAz = dir >= 0 ? az : -az;
      }
    }
    // 接触点: 双方侵入对方盒内的角点取平均 (近似接触 manifold 中心)
    let px = 0, pz = 0, n = 0;
    for(const p of _cb){ if(pointInOBB(p.x, p.z, a, 0.02)){ px+=p.x; pz+=p.z; n++; } }
    for(const p of _ca){ if(pointInOBB(p.x, p.z, b, 0.02)){ px+=p.x; pz+=p.z; n++; } }
    if(n === 0){ px = (a.pos.x+b.pos.x)/2; pz = (a.pos.z+b.pos.z)/2; n = 1; }
    return { nx:nAx, nz:nAz, depth:minDepth, px:px/n, pz:pz/n };
  }

  // 双刚体冲量求解 (运动学刚体 invMass=0 不受影响)
  // 返回 { vn, vt } 接触前相对法/切向速度; 已在分离返回 null
  const _va = {x:0,z:0}, _vb = {x:0,z:0};
  function carCarResolve(a, b, contact){
    const nx = contact.nx, nz = contact.nz;   // a → b
    const rax = contact.px - a.pos.x, raz = contact.pz - a.pos.z;
    const rbx = contact.px - b.pos.x, rbz = contact.pz - b.pos.z;
    contactVel(a, rax, raz, _va);
    contactVel(b, rbx, rbz, _vb);
    const rvx = _va.x - _vb.x, rvz = _va.z - _vb.z;   // a 相对 b
    const vn = rvx*nx + rvz*nz;                        // >0 = 正在接近
    if(vn <= 0){
      separate(a, b, contact);
      return null;
    }
    const tx = -nz, tz = nx;
    const vt = rvx*tx + rvz*tz;
    const rnA = cross(rax,raz,nx,nz), rnB = cross(rbx,rbz,nx,nz);
    const rtA = cross(rax,raz,tx,tz), rtB = cross(rbx,rbz,tx,tz);
    const kn = a._invMass + b._invMass + rnA*rnA*a._invInertia + rnB*rnB*b._invInertia;
    const kt = a._invMass + b._invMass + rtA*rtA*a._invInertia + rtB*rtB*b._invInertia;

    const jn = -(1 + CARCAR.RESTITUTION) * vn / kn;    // vn>0 → jn<0
    let jt = -vt / kt;
    if(!isFinite(jn) || !isFinite(jt)){ separate(a, b, contact); return null; } // 双方均为运动学刚体等退化情形
    const maxF = CARCAR.FRICTION * Math.abs(jn);
    jt = Math.max(-maxF, Math.min(maxF, jt));

    // a 受 jn·n (负: 沿-n 推), b 受 -jn·n
    applyImpulse(a,  jn*nx + jt*tx,  jn*nz + jt*tz, rax, raz);
    applyImpulse(b, -jn*nx - jt*tx, -jn*nz - jt*tz, rbx, rbz);

    separate(a, b, contact);
    clampBody(a); clampBody(b);
    // 返回接触详情 (供 3D 起飞/侧翻计算)
    return { vn, vt, nx, nz, px: contact.px, pz: contact.pz };
  }

  // 位置分离: 按逆质量比例分配
  function separate(a, b, contact){
    const invSum = a._invMass + b._invMass;
    if(invSum <= 0) return;
    const corr = Math.min(MAX_CORRECTION, Math.max(contact.depth - SLOP, 0) * BETA);
    const shareA = a._invMass / invSum, shareB = b._invMass / invSum;
    a.pos.x -= contact.nx * corr * shareA;
    a.pos.z -= contact.nz * corr * shareA;
    b.pos.x += contact.nx * corr * shareB;
    b.pos.z += contact.nz * corr * shareB;
  }

  return { CAR, WALL, CARCAR, wallResolve, obbContact, carCarResolve, pointInOBB };
})();
