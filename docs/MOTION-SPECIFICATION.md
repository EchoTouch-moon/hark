# Hearth 动态视觉与动效工程规范 (Motion Specification)

> 文档编号: `SPEC-MOTION-001`  
> 适用版本: Hearth Web M1 / M2  
> 责任团队: Hearth Core Engineering & Experience Guild  
> 状态: **正式发布 (Normative Specification)**

---

## 概述与核心愿景 (Overview & Vision)

Hearth 不仅仅是一个本地优先的个人 AI 助理界面，更是一处在喧嚣数字世界中为创造者提供庇护的**精神炉心（The Hearth Sanctuary）**。在传统的效率工具中，界面元素往往充斥着突兀的加载指示器、机械化的进度条以及充满刺激性的游戏化动效。Hearth 坚信：**动效应是生命体温的自然溢出，而非注意力掠夺的工具。**

本动效工程规范定义了 Hearth 桌面与 Web 端全场景的动态交互语言、时间线拓扑结构、物理着色器参数模型、内存安全机制以及无障碍降级策略。规范涵盖从底层的 WebGL GLSL 湍流合成、GSAP 时间线调度、React 声明式生命周期管理，到端到端的测试与质量审计基准，为多代理团队与工程师提供精确、可复现、严禁伪造的工程验收标准。

---

## 1. 项目整体叙事与空间隐喻拆解 (Narrative & Spatial Metaphor)

### 1.1 炉心空间 (The Hearth / Ember Sanctuary)

在 Hearth 的空间拓扑中，界面被解构为一个深邃的物理居所，其视觉与叙事重心为**炉心（Hearth）**。
- **空间景深与层级**：炉心并非浮于 UI 表层的装饰性组件，而是深居于界面中轴的后景基底层（`z-index: 0`）。所有的文本、会话气泡、项目卡片与输入容器，皆如同环绕在炉火周围的书桌、稿纸与工具。
- **有机沉淀而非游戏化分数**：炉火的火势（Heat）与生命形态绝不映射到诸如“经验值”、“连胜天数”或“成就徽章”等异化人性的度量上。它唯一忠实映射的是创造者的**真实生命投入**与**思维对话的延续性**。
- **生命律动与自律衰退**：炉火具有天然的呼吸周期。当用户沉浸构思或短暂停顿，炉火保持稳定的微弱摇曳（Sine 呼吸振幅 ≤ 3%）；当长期离开或项目搁置，余烬自然沉入炭底，不发出任何打扰式提醒或催促红点。

```
+-------------------------------------------------------------------------+
| [Layer 3: 浮层交互] 对话气泡 / 模态卡片 / 快捷输入井 (Foreground UI)       |
+-------------------------------------------------------------------------+
| [Layer 2: 物理罩层] 磨砂毛玻璃扩散层 (Frosted Glass & Ambient Diffuser)  |
+-------------------------------------------------------------------------+
| [Layer 1: 能量中心] WebGL 湍流着色器 + 火星物理粒子 (The Living Flame)   |
+-------------------------------------------------------------------------+
| [Layer 0: 空间基底] 昼夜环境色温底衬 (Background Environment Tint)       |
+-------------------------------------------------------------------------+
```

### 1.2 磨砂玻璃与单光源 (Frosted Glass & Single Light Source)

- **全站唯一生动光源**：在 Hearth 的视觉哲学中，除了环境微弱的天光外，整个界面由**炉火作为唯一的动态生动光源**驱动。界面的明暗、阴影方向、以及毛玻璃背后的辉光，全部由统一的能量度量 `--hearth-intensity` 驱动扩散。
- **物理磨砂玻璃罩层（Frosted Glass）**：
  - 炉火外部覆盖一层微物理质感的磨砂玻璃罩（`.ember-atmosphere__glass`），采用高精度 `backdrop-filter: blur(28px) saturate(140%)` 与微细噪点纹理，消除传统计算机图形学冷硬的多边形边缘，使火舌的光芒转化为充满温度的漫反射光晕。
  - 动态样式变量联动：WebGL 渲染循环在每一帧计算出的热度与响应值，直接同步至宿主容器的 CSS 变量：
    ```css
    :root {
      --hearth-intensity: 0.12; /* 映射范围 [0.0, 1.0] */
      --hearth-glow-radius: calc(180px + var(--hearth-intensity) * 140px);
      --hearth-ambient-alpha: calc(0.04 + var(--hearth-intensity) * 0.16);
    }
    ```
- **光晕衰减算法**：采用高斯扩散结合逆平方衰减函数：
  $$I(r) = I_0 \cdot \exp\left(-\frac{r^2}{2\sigma^2}\right) \cdot \frac{1}{1 + \alpha r^2}$$
  确保光芒在玻璃边缘柔和衰减，既能投射到输入井的边框微光上，又绝不造成眩光或干扰文本阅读（WCAG 对比度保障）。

### 1.3 昼夜环境色温与光度演进 (#F7F0E6 vs #1F1A17)

界面的底衬不是单调的纯黑或刺眼的纯白，而是经过精密校色的有机昼夜底色：

| 环境维度 | 白昼模式 (`day = 1.0`) | 夜间模式 (`day = 0.0`) | 过渡时长与曲线 |
| :--- | :--- | :--- | :--- |
| **基础色值** | `#F7F0E6` (晨光暖米白) | `#1F1A17` (深栗炭黑) | `1.4s`, `sine.inOut` |
| **色温氛围** | 温暖明亮，如透光亚麻，纸质手感 | 静谧幽深，如冬夜炉畔，避光护眼 | 随自然昼夜周期或系统外观同步平滑流转 |
| **炉火融合模式** | `mix-blend-mode: multiply` 局部加深，热度表现为沉稳暖赭红 | `mix-blend-mode: screen` 发光叠加，热度表现为透亮金橙与杏白 | 着色器内部基于 `u_day` 动态插值混合权重 |
| **对比度底线** | 正文 `#2C2520` (对比度 ≥ 9.2:1) | 正文 `#E8DFD5` (对比度 ≥ 10.5:1) | 始终满足 WCAG 2.2 AAA 级可读性标准 |

着色器中的昼夜混合公式：
```glsl
vec3 dayTone = mix(vec3(0.968, 0.941, 0.902), flameColor, 0.75);
vec3 nightTone = mix(vec3(0.121, 0.102, 0.090), flameColor * 1.3, 0.92);
vec3 finalColor = mix(nightTone, dayTone, u_day);
```

### 1.4 克制静音政策 (Restraint & Silent Policy)

- **绝对零非受迫音频（Zero Unsolicited Audio）**：严禁系统在动效触发时自动播放任何“咔哒”、“滴答”、“火苗噼啪”等音效。真正的陪伴应具备如图书馆一般的庄重与静谧，声音开关必须完全交由用户主动选择。
- **非侵入式微动效（Non-Intrusive Micro-Interactions）**：
  - 严禁全屏晃动、强烈频闪、跳跃震荡或弹簧振颤（No Elastic / Spring Overshoot）。
  - 当用户输入暂停，响应动效在 `420ms` 内自律收束，绝不长时间占用视网膜焦点。
  - 所有微响应位移限制在严格物理阈值内：横向位移 $\le 3\text{px}$，倾斜角 $\le 1.3^\circ$，多重状态叠加总倾角 $\le 3.0^\circ$。

---

## 2. 多代理团队协作分工与职责矩阵 (Team Roles & RACIS Matrix)

为了确保动效系统的工业级稳健性与高保真落地，团队各角色划分明确界限，杜绝无序修改与职责踩踏。

### 2.1 角色定义与核心职责

```
                +-------------------------+
                |    Motion Architect     |
                | (隐喻设计、架构、API 合同) |
                +------------+------------+
                             |
         +-------------------+-------------------+
         |                                       |
+--------v---------------+              +--------v---------------+
| Motion Engine Engineer |              | UI Component Engineer  |
| (WebGL/GLSL/粒子/数学)  |              | (GSAP/React/FLIP/DOM)  |
+--------+---------------+              +--------+---------------+
         |                                       |
         +-------------------+-------------------+
                             |
         +-------------------+-------------------+
         |                                       |
+--------v---------------+              +--------v---------------+
|   QA & Test Engineer   |              |   Reviewer & Auditor   |
| (虚拟时间单测/视觉回归)  |              | (内存安全/WCAG/红线审计) |
+------------------------+              +------------------------+
```

1. **Motion Architect (动效架构师)**:
   - 制定核心空间隐喻与生命周期状态模型；
   - 确立动效 API 合同（`EmberCueSchema`、`FlameFrame` 接口）及跨组件事件通道；
   - 维护本规范，把控动效克制与审美调性。
2. **Motion Engine Engineer (动效引擎工程师)**:
   - 编写与优化 WebGL 2.0 / WebGL 1.0 Fallback 着色器代码；
   - 实现 FBM（分形布朗运动）湍流噪声数学算法、火舌形态包络方程；
   - 维护火星（Sparks）物理发射引擎（速度矢量、重力、空气阻尼、羽化寿命）；
   - 保证 60 FPS 恒定帧率与移动端/低功耗设备着色器性能。
3. **UI Component Engineer (UI 组件工程师)**:
   - 负责 React 顶层组件（`EmberAtmosphere`、`ChatPage`、`AppShell`）中的 GSAP 落地；
   - 运用 `@gsap/react` 的 `useGSAP` 实现严格作用域隔离；
   - 实现输入井展开/收起的 FLIP（First, Last, Invert, Play）几何位移变换；
   - 管理事件总线绑定与卸载时的物理资源释放。
4. **QA & Test Engineer (动效测试工程师)**:
   - 编写虚拟时间单测，通过 GSAP `timeline.seek()` 和 `flame.heat` 公式做数学级断言；
   - 搭建 Playwright 端到端视觉回归测试流水线，捕获关键生命周期的无损帧；
   - 监控渲染管线崩溃率与降级机制（`webglcontextlost` 恢复流程）。
5. **Reviewer & Auditor (代码审查员与独立审计员)**:
   - 执行“绝对红线”审查：验证视觉 cue 绝不携带敏感业务数据与项目隐私；
   - 审查内存泄漏防线：确认所有 GSAP timeline、resize 监听、WebGL texture 在 unmount 时完全 dispose；
   - 审查 WCAG 2.2 AA 级无障碍免频闪与 `prefers-reduced-motion` 强力适配。

### 2.2 RACIS 交付责任矩阵

- **R (Responsible)**: 实际执行编写/实现的人
- **A (Accountable)**: 最终对质量负责并拥有决策签字权的人
- **C (Consulted)**: 需征询意见并提供输入的人
- **I (Informed)**: 需被同步进度或交付结果的人
- **S (Supportive)**: 协同提供资源或环境支持的人

| 交付模块 / 任务项 | Architect | Engine Eng | UI Eng | QA Eng | Auditor |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **动效 API 合同与事件规范 (`EmberCueSchema`)** | **A** | C | R | I | C |
| **WebGL 着色器与火舌流体数学模型 (`flameRenderer.ts`)** | C | **A / R** | S | I | C |
| **火星粒子物理系统与飞升轨迹算法** | I | **A / R** | S | R | I |
| **五大生命状态计算与流转公式 (`projectEmber.ts`)** | **A** | C | R | R | I |
| **GSAP 主时钟与微交互时间线集成 (`EmberAtmosphere.tsx`)** | C | S | **A / R** | C | C |
| **输入容器 FLIP 几何空间位移变换 (`ChatPage.tsx`)** | I | I | **A / R** | R | I |
| **React 卸载清理与内存泄漏防护 (Leak-free Guarantees)** | C | S | R | I | **A** |
| **WCAG 2.2 AA 无障碍与减弱动态效果 (Reduced Motion)** | C | I | R | R | **A** |
| **虚拟时间 seek() 单元测试套件 (`project-ember.test.ts`)** | I | S | S | **A / R** | C |
| **Playwright 视觉验收与无头浏览器截图流水线** | I | I | S | **A / R** | C |
| **零隐私泄漏安全审计与只读上下文审计** | C | I | I | I | **A** |


---

## 3. 五大火焰生命状态动效规范 (Living Flame 5-Stage Lifecycle)

Hearth 的核心炉火绝非无生气的静态画布，而是拥有完整生命周期的有机能量体。通过对项目生命历程、服务端持久化确认的会话消息以及敏捷卡片闭环状态的计算，炉火在**五大经典生命状态**间平滑演化。

```
           +-------------------------------------------------------------+
           |                       项目创立 / 初遇                        |
           +------------------------------+------------------------------+
                                          |
                                          v
                                   [ 1. SPARK 初火星 ]
                              (heat: 0.12, 粒子: 8, 孤火静立)
                                          |
                       用户发送首条确认消息 / 观察器探测到初始活动
                                          |
                                          v
                                  [ 2. SPROUT 初生火苗 ]
                              (heat: 0.42-0.53, 粒子: 16, 抽芽微绽)
                                          |
                      连续 3+ 轮深入探讨 / 24h 内高频活跃与活跃卡片推进
                                          |
                                          v
                                  [ 3. BLAZE 繁盛之火 ]
                           (heat: 0.65-0.89, 粒子: 32, 炽烈奔涌)
                                   /             \
                   阶段成果全量完成 /               \ 项目搁置 > 7 天 /
                   测试全部通过闭环                  \ 显式禁用停用
                                 /                 \
                                v                   v
                     [ 4. GOLDEN 常明金火 ]     [ 5. DORMANT 静卧余烬 ]
                 (heat: 0.72, golden: 1.0,   (heat: 0.10, dormant: 1.0,
                    粒子: 48, 澄澈不息)           粒子: 2, 炭底暗红)
                                 \                 /
                                  \ 添柴 / 再次开口 /
                                   \             /
                                    v           v
                                 平滑复燃回到活跃态
```

### 3.1 五大状态参数矩阵 (Parameter Matrix)

着色器 Uniforms 与粒子引擎每帧接收 `FlameFrame` 结构，各状态的标准基准参数与视觉行为定义如下：

| 参数 / 属性 | 1. 初火星 (`spark`) | 2. 初生火苗 (`sprout`) | 3. 繁盛之火 (`blaze`) | 4. 常明金火 (`golden`) | 5. 静卧余烬 (`dormant`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **基础热度 (`heat`)** | `0.12` | `0.42 ~ 0.53` | **`0.65 ~ 0.89`** | `0.72` | `0.10` |
| **体量缩放 (`size`)** | `0.85` | `1.00` | `1.18` | `1.12` | `0.70` |
| **金火因子 (`golden`)** | `0.00` | `0.00` | `0.00` | **`1.00`** | `0.00` |
| **休眠因子 (`dormant`)** | `0.00` | `0.00` | `0.00` | `0.00` | **`1.00`** |
| **动态涌浪上限 (`surge`)** | `0.30` | `0.45` | `0.65` | `0.40` | `0.20` |
| **输入脉冲幅度 (`pulse`)** | `0.15` | `0.22` | `0.28` | `0.18` | `0.08` |
| **飞升火星粒子数 (`sparks`)** | **8 颗** | **16 颗** | **32 颗** | **48 颗 (金粉碎光)** | **2 颗 (沉寂微屑)** |
| **火焰包络形态 (Envelope)** | 单尖细锥，火心极低 | 双火舌起伏，初具火腹 | 三火舌分叉，主尖右倾弯折 | 稳固宽厚梯形，金芒外溢 | 扁平椭圆，无上扬外焰 |
| **主导色谱 (RGB Palette)** | 黯淡赭橙 (`#B85C38`) | 杏黄暖橙 (`#E07A5F`) | 白炽热核-杏黄-赤红 (`#F4A261`) | 澄澈浅金-暖阳金 (`#F2CC8F`) | 暗褐冷灰-炭火暗红 (`#4A2818`) |
| **诗意状态文案** | 项目刚创立，正如夜空初绽的一粒火星。从第一句话开始点燃。 | 想法已经抽芽，火苗轻轻摇曳。随着交流展开，它将逐渐壮大。 | 思路与代码正如火如荼地推进，炉火热烈翻腾、生机盎然。 | 阶段成果圆满达成。炉火澄澈金黄，沉静守护每一份成果。 | 项目暂时搁置，暗火微温沉睡在炭底。添一把柴，便能随时复燃。 |
| **Badge 视觉基调** | `neutral` (素净灰阶) | `warning` (嫩芽暖黄) | `info` (生机青蓝) | `success` (成就暖金) | `neutral` (寂静炭灰) |

### 3.2 Blaze 状态计算公式修复与推导 (Blaze Formula Rectification)

在早期版本的实现中，Blaze 与 Sprout 的热度计算公式存在重叠缺陷：
- **旧公式缺陷**：
  $$\text{intensity}_{\text{legacy}} = 0.42 + (\text{clamp}(\text{confirmedCount}, 1, 4) - 1) \times 0.11$$
  当确认消息数达到 3 条（触发 Blaze 阈值）时，$\text{steps} = 3 - 1 = 2$，计算所得热度为 $0.42 + 2 \times 0.11 = 0.64$。
  这不仅与 QA 自动化测试基准 `heat >= 0.65` 发生断言冲突，更导致“初生火苗的最高阶段（0.53）”与“繁盛之火（0.64）”未能形成显著的物理能量跃迁。
- **修复后的正式工程公式**：
  $$\text{steps} = \text{clamp}(\text{confirmedCount} - 2, 0, 3)$$
  $$\text{intensity}_{\text{blaze}} = 0.65 + \text{steps} \times 0.08$$
  - 当 $\text{confirmedCount} = 3$ 时：$\text{steps} = 1$，$\text{intensity} = 0.65 + 0.08 = 0.73$（基准起步 $\ge 0.65$）；
  - 当 $\text{confirmedCount} = 2$ 且满足 24h 内活跃工作时：$\text{steps} = 0$，$\text{intensity} = 0.65$；
  - 当 $\text{confirmedCount} \ge 5$ 时：达到饱和封顶值 $0.65 + 3 \times 0.08 = 0.89$。
  该公式确保了繁盛态拥有独立且充满爆发力的能量区间 $[0.65, 0.89]$，完美契合物理火焰从层流跃升至旺盛湍流的视觉规律。

### 3.3 状态平滑流转机制 (1.1s - 1.4s Smooth Interpolation)

生命状态的更迭严禁出现任何阶跃跳变（Hard Cut）。状态跃迁必须由 GSAP 全局缓动管道驱动：
- **插值管道**：
  ```typescript
  useGSAP(() => {
    gsap.to(frame.current, {
      heat: targetHeat,
      size: targetSize,
      golden: targetGolden,
      dormant: targetDormant,
      duration: still ? 0 : 1.25, // 统一控制在 1.1s - 1.4s 区间
      ease: 'sine.inOut',
      overwrite: 'auto',
      onUpdate: () => drawRef.current(true),
    });
  }, { scope: root, dependencies: [heat, size, golden, dormant, still] });
  ```
- **连续性保障（C1 Continuity）**：
  通过 `overwrite: 'auto'` 机制，当用户在流转中途再次触发新的状态更迭（例如点燃过程中突然断网或项目被搁置），GSAP 会从当前帧的实时速度与数值直接平滑接管，避免二次启动的加速度突变。

---

## 4. 核心交互事件与动作时间线设计 (Interaction Event Timelines)

界面的微交互与火焰状态通过高内聚、低耦合的 **EmberCue 事件总线**（`readEmberCue` / `emitEmberCue`）联动。所有事件仅携带纯粹的**视觉意图（Visual Intent）**，绝不包含任何用户输入内容、文件路径或敏感业务载荷。

### 4.1 添柴与观测激发 (Stoke & Sparks Eruption)

当用户在界面中点击“添柴观测”按钮，或后台观察器完成一轮深度项目扫描时，触发 `stoke` 事件。
- **时间线动作编排**：
  ```
  Time (s):  0.0       0.22                                   1.57
  Surge:     0.0 ----> 0.55 (power2.out 强劲跃升) ------------> 0.0 (sine.inOut 柔和回落)
  Sparks:    [ 32 颗物理粒子瞬时激发，向上风切扩散 ]
  ```
- **参数控制与源码映射**：
  ```typescript
  const surge = gsap.timeline({ paused: true });
  const triggerStoke = () => {
    surge.clear();
    surge.to(frame.current, {
      surge: 0.55,
      duration: 0.22,
      ease: 'power2.out',
      onUpdate: () => draw(true)
    })
    .to(frame.current, {
      surge: 0,
      duration: 1.35,
      ease: 'sine.inOut',
      onUpdate: () => draw(true)
    });
    surge.restart();
    renderer?.triggerSparks(32);
  };
  ```
- **火星粒子物理运动学模型**：
  每个粒子生成时赋予随机向上的初速度矢量与空气阻尼：
  $$v_y(0) = -(2.8 + \text{rand}() \times 3.2), \quad v_x(0) = (\text{rand}() - 0.5) \times 1.6$$
  $$x(t) = x_0 + \int v_x dt + \sin(\omega t + \phi) \cdot \text{sway}$$
  $$y(t) = y_0 + \int v_y dt + \frac{1}{2} g t^2$$
  伴随透明度 $\alpha(t) = 1.0 - (t / t_{\text{max}})^{1.4}$ 的平滑衰减，在炉心上方形成逼真的上升气流碎屑效果。

### 4.2 对话微交互链路 (Conversation Interaction Chain)

整个对话交互过程被拆解为精密的心流闭环，火舌随思考与键入节奏自然呼吸：

```
       [ 待机微光: Rest ]
             |
             | 用户光标汇入输入框 (focus)
             v
      [ 向心聚合: Focus ]  (attention: 0.14, 400ms, sine.out)
             |
             | 用户连续敲击键盘 (typing, 节流 400ms)
             v
      [ 节奏律动: Pulse ]  (pulse: 0.26 展开 320ms -> 800ms 回弹)
             |
             | 按下 Enter 发送，等待模型生成 (waiting)
             v
      [ 悠长呼吸: Waiting ] (waiting: 0.16 周期 1.8s, yoyo 循环)
             |
      +------+--------------------------+
      |                                 |
      | 服务端确认回传 (acknowledged)    | 请求超时 / 失败 (request-failed)
      v                                 v
[ 欢跃散花: Ack Pulse ]          [ 避让收敛: Collapse ]
(waiting 归零, 触发脉冲绽放)        (waiting 暂停, attention 倒放归零)
      |                                 |
      +----------------+----------------+
                       | 光标移出 (release)
                       v
                 [ 重归静息: Rest ]
```

1. **Focus (光标就位)**：`frame.attention` 在 400ms 内由 `0.0` 升至 `0.14`（`sine.out`）。着色器将火舌两侧边缘向中心收窄 $4\%$，模拟气流向内吸引、聚精会神的向心视觉隐喻。
2. **Release (失焦离去)**：`focus.reverse()`，火舌在 400ms 内柔和舒展回原有宽度。
3. **Typing (按键激荡)**：输入事件触发 `triggerPulse()`。带有严格的 `400ms` 节流锁，防止高频击键导致时间线堆叠与垃圾回收压力。`pulse` 值在 320ms 展开至 `0.26`，随后 800ms 平滑衰减归零。
4. **Waiting (等待思索)**：长循环呼吸动效。`frame.waiting` 以 1.8s 为半周期在 `0.0` 到 `0.16` 间往返（`repeat: -1, yoyo: true, ease: 'sine.inOut'`），火舌底部产生规律的明暗微光。
5. **Acknowledged (确认送达)**：收到服务端响应，立即调用 `waiting.pause(0)` 停止等待循环，并无缝衔接一次清脆的 `triggerPulse()`，庆祝思绪达成连接。
6. **Request-Failed (请求失败)**：立即暂停所有激荡脉冲，强制反向收敛 `focus.reverse()`。炉火收敛至静息安全态，不产生刺眼的闪烁报错，仅通过前台 UI 容器的温和边框色彩与提示文本通知用户。

### 4.3 输入框 FLIP 几何位移变换 (Composer FLIP Geometry Transition)

Hearth 的首遇体验至关重要。初次进入时，输入框位于屏幕正中央的“火种位”（Seed Slot）；而当首条对话发出后，输入框必须丝滑移动至底部吸附位（Composer Bottom Dock）。

- **绝对避免 DOM 重建**：严禁在居中态和吸底态之间销毁并重新挂载 `<textarea>`。重新挂载会导致浏览器的 IME 中文输入法组合合成状态断裂、光标跳动以及历史堆栈丢失。
- **FLIP 原理落地与源码拓扑**：
  1. **First**: 捕获当前节点在视口中的绝对几何坐标：
     ```typescript
     const rect = node.getBoundingClientRect();
     const previous = previousRect.current;
     ```
  2. **Last**: 状态变更引发 React 重新计算布局（例如 `showSeed` 变为 `false`），DOM 属性切换至底部停靠。
  3. **Invert**: 计算空间位移矢量 $\Delta x = x_{\text{prev}} - x_{\text{current}}$，$\Delta y = y_{\text{prev}} - y_{\text{current}}$。通过 CSS Transform 反向偏移，使元素视觉上瞬间留在原位：
     ```typescript
     gsap.set(node, { x: previous.x - rect.x, y: previous.y - rect.y });
     ```
  4. **Play**: 使用高品质缓动曲线在 `400ms` 内驱动变换归零，并在动画完成时清除行内样式：
     ```typescript
     timeline.fromTo(
       node,
       { x: previous.x - rect.x, y: previous.y - rect.y },
       { x: 0, y: 0, duration: 0.4, ease: 'power3.out', clearProps: 'transform' },
       0
     );
     ```
- **伴随转场（Accompanied Transition）**：在输入框下落的同时，消息流展示区（`columnRef.current`）在 700ms 内以 `power3.out` 执行 `opacity: 0.3 -> 1.0` 展开渐显，形成行云流水般的空间展开感。


---

## 5. GSAP 时间线系统架构与缓动标准 (GSAP Timeline Architecture & Easing)

为了保证复杂多层动态视觉的确定性、精确可控性与极低 CPU/GPU 开销，Hearth 动效架构严格基于 **GreenSock Animation Platform (GSAP 3)** 构建分层时间线拓扑结构。

### 5.1 分层时间线拓扑结构 (Hierarchical Timeline Topology)

系统中所有的动态行为被划分为三个严格解耦、正交运行的时间线层级：

```
+-------------------------------------------------------------------------+
| [Tier 0: 虚拟主时钟 Master Clock]                                       |
| gsap.timeline({ repeat: -1 }) -> 驱动 frame.current.time 持续单调递增    |
+-------------------------------------------------------------------------+
                                     |
                                     | 驱动渲染帧循环 (draw())
                                     v
+-------------------------------------------------------------------------+
| [Tier 1: 状态流转管道 State Transitions]                                 |
| 监听 Props/Store 变更 -> heat, size, golden, dormant 平滑插值 (1.25s)   |
+-------------------------------------------------------------------------+
                                     |
                                     | 参数叠加
                                     v
+-------------------------------------------------------------------------+
| [Tier 2: 瞬态微交互时间线 Micro-Interactions]                             |
| focus (400ms) | pulse (320ms+800ms) | waiting (1.8s) | surge (220ms)    |
+-------------------------------------------------------------------------+
```

1. **虚拟主时钟 (Tier 0: Master Clock)**:
   - WebGL 内部的时间流逝不依赖不可靠的 `setInterval` 或各自独立的 `requestAnimationFrame` 累加，而是由单一受控的 GSAP 主时间线驱动：
     ```typescript
     const clock = gsap.timeline({ paused: true })
       .to(frame.current, {
         time: '+=86400',
         duration: 86400,
         repeat: -1,
         ease: 'none',
         onUpdate: draw
       });
     ```
   - **单调性与精度保护**：通过大步长线性补间，杜绝 JavaScript 浮点数长时间运行累加导致的精度衰减；当页面切后台（`document.hidden`）或全局暂停时，主时钟与微交互时间线原子级同步挂起，恢复时无缝衔接原物理帧。
2. **生命状态流转管道 (Tier 1: State Transition Pipeline)**:
   - 负责长期生命状态（`heat`, `size`, `golden`, `dormant`）的过渡。
   - 采用独立补间轨道，与高频的微交互解耦，避免用户击键脉冲冲刷掉底层的基础炉温。
3. **瞬态微交互时间线 (Tier 2: Micro-Interaction Timelines)**:
   - 维护 `focus`、`pulse`、`waiting`、`surge` 四个独立的 Timeline 实例。
   - 每个实例独占操作 `frame.current` 的特定通道，通过物理着色器的加权混合模型输出最终形态，杜绝多条时间线竞争同一属性引起的帧闪烁。

### 5.2 缓动设计令牌体系 (Motion Easing Design Tokens)

为统一全站动效的质感与情感表达，系统确立四套标准缓动设计令牌（Easing Tokens）：

```
   1.0 +---------------+                   1.0 +               +---+
       |     * * * * * |                       |  *         *  |   |
       |   *           |                       | *   *   *   * |   |
       | *             |                       |*     * *     *|   |
   0.0 +---------------+                   0.0 +---------------+---+
           gentle (sine.inOut)                     breath (sine.inOut / yoyo)
   
   1.0 +--*------------+                   1.0 +---*-----------+
       | *             |                       |  *            |
       |*              |                       | *             |
       |*              |                       |*              |
   0.0 +---------------+                   0.0 +---------------+
           burst (power2.out)                      snap (power3.out)
```

| Token 标识 | GSAP 缓动定义 | 典型持续时间 | 物理质感与隐喻 | 应用场景 |
| :--- | :--- | :---: | :--- | :--- |
| **`gentle`** | `sine.inOut` | `1.1s ~ 1.4s` | 惯性充沛、平缓舒展，如深海涌浪、昼夜更替 | 五大生命状态演进、昼夜模式色温切换、炉心体量缩放 |
| **`breath`** | `sine.inOut` (yoyo) | `1.8s` (半周) | 规律呼吸、沉静待机，如静思者的胸腔起伏 | 模型思考等待 (`waiting`)、待机微澜、余烬微光呼吸 |
| **`burst`** | `power2.out` | `220ms` | 瞬间引燃、势能喷发，前快后慢的高能爆发 | 添柴激荡 (`stoke`)、扫描激发、火星破空破壳 |
| **`snap`** | `power3.out` | `400ms` | 迅捷轻盈、落点精准无残影，无弹簧超调 | 输入框 FLIP 位移、气泡弹出收起、侧栏抽屉展开 |

### 5.3 标签编排与相对时间偏移 (Labels & Relative Offsets)

在复合型动效（例如点燃序列、多段落叙事展开）中，严禁使用散落的 `setTimeout` 进行时序拼凑，必须采用 GSAP 的 **Labels（时标锚点）** 与 **相对时间偏移符** 进行多轨编排：

```typescript
const ignitionTimeline = gsap.timeline({ defaults: { ease: 'power3.out' } });

ignitionTimeline
  .addLabel('core')
  .fromTo(coreFlame, { scale: 0.2, opacity: 0 }, { scale: 1.0, opacity: 1.0, duration: 0.55 }, 'core')
  .addLabel('wings', '+=0.055') // 错峰 55ms
  .fromTo(leftWing, { rotation: -12, opacity: 0 }, { rotation: 0, opacity: 0.85, duration: 0.6 }, 'wings')
  .fromTo(rightWing, { rotation: 12, opacity: 0 }, { rotation: 0, opacity: 0.85, duration: 0.6 }, 'wings+=0.04')
  .addLabel('mantle', '-=0.2') // 提前 200ms 重叠交错
  .fromTo(outerMantle, { scaleY: 0.4, opacity: 0 }, { scaleY: 1.0, opacity: 0.9, duration: 0.7 }, 'mantle');
```

- **错峰时序设计**：通过 `+=0.055` 的微妙时间差，先点亮内芯、再展开侧翼、最后升腾外焰，赋予火焰符合燃烧物理规律的有机生长感。
- **重叠交错**：采用 `-=` 相对前移，消除阶段间的断点停顿，确保各火舌的能量流转浑然一体。

---

## 6. React 生命周期管理与无内存泄漏机制 (Lifecycle & Leak-Free Architecture)

在现代单页应用（SPA）中，动效系统是内存泄漏与上下文失控的高发区。尤其在结合 React 18+ 的 StrictMode 双重挂载以及长生命周期的 WebGL 渲染管线时，必须实施**零容忍的物理级资源释放规范**。

### 6.1 `@gsap/react` `useGSAP` 核心规程

所有组件内的 GSAP 动画逻辑一律使用官方 `@gsap/react` 提供的 `useGSAP` 钩子，严禁在常规 `useEffect` 中裸写未受控的 `gsap.to()`。

```typescript
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';

gsap.registerPlugin(useGSAP);

export function LivingAtmosphere() {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    // 1. 严格作用域：所有类名/选择器解析限定在 container 内，绝不跨越组件界限
    gsap.to('.ember-atmosphere__fallback-flame', {
      scale: 1.05,
      duration: 1.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  }, {
    scope: container,          // 约束作用域
    revertOnUpdate: true,      // 依赖变化重新执行前自动完全回滚旧补间
    dependencies: [/* ... */]
  });

  return <div ref={container} className="ember-atmosphere">{/* ... */}</div>;
}
```

- **作用域约束 (`scope: container`)**：消除全局 DOM 查询冲突。
- **更新自动回滚 (`revertOnUpdate: true`)**：当输入属性变更引发动画重建时，GSAP 自动将之前补间影响的所有 DOM 样式安全还原，杜绝旧补间与新补间在同一节点上的样式竞争与累积漂移。

### 6.2 `contextSafe` 包装异步事件 (Safe Async Invocations)

在用户事件（如滚动、点击、键盘敲击）或异步响应（WebSocket、Fetch 回调）中动态创建补间时，必须使用 `contextSafe` 进行防断裂包装：

```typescript
const { contextSafe } = useGSAP({ scope: container });

const onUserTyping = contextSafe((intensity: number) => {
  // 即使在用户快速切换路由、组件即将卸载的极端竞态条件下，
  // contextSafe 也能自动拦截失效补间，防止向已脱落的 DOM 节点执行写入。
  gsap.to(flameRef.current, {
    pulse: intensity,
    duration: 0.3,
    ease: 'sine.out',
    onComplete: () => { /* safe callback */ }
  });
});
```

### 6.3 卸载阶段彻底释放与垃圾回收 (Unmount & Disposal Checklist)

组件在被销毁或路由跳转时，必须无条件履行以下**终极清理清单**：

```
+-------------------------------------------------------------------------+
|                    React Component unmount 触发                         |
+-------------------------------------------------------------------------+
                                     |
    +--------------------------------+--------------------------------+
    |                                                                 |
    v                                                                 v
[ GSAP 上下文回滚 ]                                             [ WebGL 硬件管线销毁 ]
- ctx.revert() 撤销所有 Tween                                    - renderer.dispose()
- timeline.kill() 清空调度队列                                   - gl.deleteProgram()
- clearProps: 'transform,opacity'                               - gl.deleteShader()
- 内部动画对象句柄赋 null                                         - gl.deleteBuffer()
                                                                 - gl.deleteTexture()
    |                                                                 |
    +--------------------------------+--------------------------------+
                                     |
                                     v
                          [ 系统级事件监听解绑 ]
                          - window.removeEventListener('resize')
                          - window.removeEventListener(EMBER_CUE_EVENT)
                          - document.removeEventListener('visibilitychange')
                          - canvas.removeEventListener('webglcontextlost')
                          - canvas.removeEventListener('webglcontextrestored')
                          - ResizeObserver.disconnect()
                                     |
                                     v
                          [ 内存完全回收 (Zero Leaks) ]
```

1. **GSAP 资源释放**：
   - 依赖 `useGSAP` 的返回值生命周期，自动触发 `ctx.revert()`；
   - 手动维护的 `timelines.current = []` 必须在清理函数中显式置空引用，打破闭包持有的 DOM 强引用。
2. **WebGL 显存与程序释放 (`flameRenderer.dispose()`)**：
   ```typescript
   export function createFlameRenderer(canvas: HTMLCanvasElement): FlameRenderer {
     const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
     // ...
     return {
       // ...
       dispose: () => {
         if (!gl) return;
         gl.useProgram(null);
         if (program) gl.deleteProgram(program);
         if (vertShader) gl.deleteShader(vertShader);
         if (fragShader) gl.deleteShader(fragShader);
         if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
         if (texture) gl.deleteTexture(texture);
         // 显式解绑扩展与重置 WebGL 状态
         const loseContext = gl.getExtension('WEBGL_lose_context');
         if (loseContext) loseContext.loseContext();
       }
     };
   }
   ```
3. **上下文丢失与恢复自愈机制 (`webglcontextlost` & `webglcontextrestored`)**：
   - 监听 `webglcontextlost` 事件，阻止默认行为（`event.preventDefault()`），立即触发 `renderer.dispose()` 并将 UI 状态平滑降级为 CSS/SVG Fallback；
   - 监听 `webglcontextrestored` 事件，重新初始化 WebGL Program 与纹理贴图，自动自愈恢复渲染，保证系统即使在 GPU 驱动重置或长久息屏唤醒后依然坚如磐石。


---

## 7. 动效降级与无障碍标准 (Accessibility & Degradation Standards)

动效绝不应成为任何用户的生理或心理负担。Hearth 动效系统严格遵循 **W3C WCAG 2.2 AA / AAA** 级可访问性规范，建立全套降级与无障碍自适应标准。

### 7.1 WCAG 2.2 AA 免频闪红线 (Seizure & Flicker Prevention)

- **绝对禁止超过安全阈值的频闪（Three Flashes Threshold）**：
  严格遵循 WCAG 2.2 Guideline 2.3.1（Three Flashes or Below Threshold）。在任何连续 1 秒钟内，严禁界面出现超过 3 次的强光突变或明暗快速交替。
- **光度变化速率限制**：
  在着色器渲染与微交互脉冲中，明度（Luminance）在时间轴上的变化率导数必须满足：
  $$\left|\frac{d L}{d t}\right| \le 1.8 \text{ units/s}$$
  严禁使用纯白到纯黑的瞬时跳变，所有状态转换强制包裹在 $\ge 320\text{ms}$ 的柔和缓动封套中。
- **语义完整与遮挡防护**：
  - 炉火与光晕组件是纯粹的氛围与情感隐喻，强制标注 `aria-hidden="true"`，不向屏幕阅读器（Screen Readers）暴露混乱的图像描述；
  - 项目状态、生命阶段、炉温与健康度，一律在前台通过语义化 HTML 文本（如 `stageLabel`、`fuelHint`）以及辅助标签（如 `role="status"`、`aria-live="polite"`）显式呈现，保证视障用户获得 $100\%$ 对等的系统理解。

### 7.2 系统级 `prefers-reduced-motion` 强力响应

系统时刻监听操作系统层级的无障碍动效减弱偏好：

```typescript
const media = window.matchMedia('(prefers-reduced-motion: reduce)');
const [reduced, setReduced] = useState(() => media.matches);

useEffect(() => {
  const handler = () => setReduced(media.matches);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}, []);
```

### 7.3 终态快进原则 (Instant End-state Seek Principle)

当用户系统开启了 `prefers-reduced-motion: reduce`，或在 Hearth 设置中开启了“暂停动效”时，系统**绝不执行漫长的过渡动画，但也绝不展示残缺的中间态**，而是坚决执行**终态快进原则**：

```typescript
// 1. 对于状态流转补间：将过渡持续时间置为 0，瞬时就位
gsap.to(frame.current, {
  heat: targetHeat,
  size: targetSize,
  golden: targetGolden,
  dormant: targetDormant,
  duration: still ? 0 : 1.25, // 动效减弱时 duration 降为 0
  overwrite: 'auto',
  onUpdate: () => drawRef.current(true),
});

// 2. 对于已在运行的时间线：直接快进至进度终点并挂起
if (still) {
  timeline.progress(1).pause();
}
```

- **FLIP 几何变换快进**：在输入框位置转换时，跳过 400ms 的平移动画，直接清除 transform 偏移，使输入框立即稳定停靠在目标位置，保留完整的输入交互响应。
- **静态美感保全**：炉火着色器不被隐藏，而是停留在当前热度所对应的一帧优美静态造型（微风静止），依然能感知项目的生命状态，但消除了任何可能引发前庭功能障碍或眩晕的流体移动。

---

## 8. 验证基准与测试指导规范 (Verification & Benchmark Standards)

为了捍卫 Hearth“执行工程师而非产品幻想叙述者”的根本信念，所有动效行为必须通过自动化工程手段进行严格、可量化、不可伪造的检验。

### 8.1 虚拟时间 `seek()` 单元测试方案 (Virtual-Time Unit Testing)

依靠真实时间流逝（`setTimeout` / `sleep`）的测试是脆弱、缓慢且不可信的。动效测试必须采用**虚拟时间快进（Virtual Time Seek）**与**确定性纯函数断言**。

#### 1. 生命状态纯函数数学断言 (`tests/unit/project-ember.test.ts`)
无需挂载真实浏览器，通过精准的输入结构体（确认消息数、时间戳、卡片完成度），对 `deriveProjectFlame` 输出做确定性物理参数断言：

```typescript
describe('项目火焰生命历程计算 (deriveProjectFlame)', () => {
  const now = Date.parse('2026-10-30T10:00:00+08:00');

  it('连续活跃交流与积极推进演进为繁盛之火 (blaze)', () => {
    const flame = deriveProjectFlame({
      nowMs: now,
      confirmedUserMessages: [
        { role: 'user', createdAt: new Date(now - 3000).toISOString(), id: 'msg-1' },
        { role: 'user', createdAt: new Date(now - 2000).toISOString(), id: 'msg-2' },
        { role: 'user', createdAt: new Date(now - 1000).toISOString(), id: 'msg-3' },
      ],
    });
    expect(flame.stage).toBe('blaze');
    expect(flame.stageLabel).toBe('繁盛之火');
    // 严格断言起步热度必须满足 >= 0.65，杜绝低能量回归
    expect(flame.heat).toBeGreaterThanOrEqual(0.65);
    expect(flame.golden).toBe(0.0);
    expect(flame.dormant).toBe(0.0);
  });
});
```

#### 2. GSAP 时间线时序断言
在单元测试环境中导入 GSAP，通过虚拟时钟操作快进并采样：
```typescript
it('添柴激荡在 220ms 冲顶并在 1.57s 完全衰减', () => {
  const frame = { surge: 0 };
  const surgeTimeline = gsap.timeline({ paused: true });
  surgeTimeline
    .to(frame, { surge: 0.55, duration: 0.22, ease: 'power2.out' })
    .to(frame, { surge: 0, duration: 1.35, ease: 'sine.inOut' });

  // 虚拟时间验证起点
  expect(frame.surge).toBe(0);

  // 快进至爆发峰值 (t = 0.22s)
  surgeTimeline.seek(0.22);
  expect(frame.surge).toBeCloseTo(0.55, 2);

  // 快进至衰减中段 (t = 0.8s)
  surgeTimeline.seek(0.8);
  expect(frame.surge).toBeGreaterThan(0.0);
  expect(frame.surge).toBeLessThan(0.55);

  // 快进至彻底收拢 (t = 1.57s)
  surgeTimeline.seek(1.57);
  expect(frame.surge).toBe(0);
});
```

### 8.2 Playwright 视觉验收与无头流水线 (E2E Visual Regression)

真实的视觉闭环必须在真实无头浏览器（Headless Chromium）中验证，测试脚本位于 `scripts/qa/living-flame-lifecycle.mjs`。

#### 1. 验收矩阵标准

| 序号 | 验证阶段 / 场景 | 操作步骤 | 验收断言与证据留存 |
| :---: | :--- | :--- | :--- |
| **01** | **初遇火星 (`spark`)** | 打开新会话页面，无任何已确认消息 | `data-flame-stage="spark"`, `data-heat="0.12"`, 输入框处于居中 Seed 位，留存截图 `01-flame-spark.png` |
| **02** | **添柴与火星喷发 (`stoke`)** | 点击 `.flame-life-card__stoke` 按钮 | `data-cue="stoke"`, `data-phase="stoke"`, WebGL 触发 32 颗粒子生成，留存截图 `02-flame-stoke-eruption.png` |
| **03** | **初生火苗 (`sprout`)** | 发送首条消息并获得服务端历史确认 | `data-flame-stage="sprout"`, FLIP 完成输入框吸底（无 DOM 重构），留存截图 `03-flame-sprout.png` |
| **04** | **繁盛之火 (`blaze`)** | 模拟 3 轮连续对话推进 | `data-flame-stage="blaze"`, `data-heat >= 0.65`, 火舌明显变高且侧翼展开，留存截图 `04-flame-blaze.png` |
| **05** | **常明金火 (`golden`)** | 模拟注入全部完成的测试卡片 | `data-flame-stage="golden"`, `data-golden="1.00"`, 呈现金粉碎屑，留存截图 `05-flame-golden.png` |
| **06** | **静卧余烬 (`dormant`)** | 模拟停用项目或历史时间超过 7 天 | `data-flame-stage="dormant"`, `data-dormant="1.00"`, 火焰高度压缩至炭底，留存截图 `06-flame-dormant.png` |
| **07** | **减弱动态效果验证** | 模拟 `page.emulateMedia({ reducedMotion: 'reduce' })` | 页面保持完整静态轮廓，`data-still="true"`, 动画全部就位不产生运动，留存截图 `07-flame-reduced-motion.png` |

#### 2. 执行与自动化复现命令
```bash
# 1. 运行生命历程与视觉 cue 核心单测
pnpm exec vitest run tests/unit/project-ember.test.ts
pnpm exec vitest run tests/unit/ember-cues.test.ts

# 2. 运行真实浏览器端到端生命周期验收
node scripts/qa/living-flame-lifecycle.mjs
```

### 8.3 帧率与性能基准红线 (Performance Benchmark Redlines)

在典型的中端笔记本及主流移动端设备上，动效系统必须严格满足以下硬性性能指标：

- **帧率底线**：持续渲染帧率 $\ge 58 \text{ FPS}$（在 60Hz 刷新率显示器下）；
- **主线程阻塞**：任何微交互（focus/pulse/FLIP）引起的 Long Task（> 50ms）为 **0 个**；
- **内存稳定性**：连续运行 10 分钟或快速切换 50 次会话路由，Chrome DevTools 堆内存（JS Heap）增长率 $\le 2\text{MB}$，无脱落 DOM 节点（Detached Elements）残留；
- **GPU 功耗控制**：在页面切后台（`document.hidden === true`）或静止状态时，WebGL 渲染立即完全停止（`draw` 帧率为 0），严格杜绝后台无效耗电。

---

## 9. 规范版本记录与签署 (Sign-off & Revision History)

| 版本 | 日期 | 变更内容 | 编写人 | 审查人 | 状态 |
| :---: | :---: | :--- | :---: | :---: | :---: |
| `1.0.0` | 2026-10-29 | 初始草案，确立叙事隐喻与基础三态 | Motion Architect | Core Guild | Superseded |
| `1.1.0` | 2026-10-30 | 升级至五大生命状态，集成 GSAP 3 架构，规范 FLIP 位移与添柴激荡 | worker_m1_gen4 | Teamwork Auditor | **Approved / Normative** |

**规范批准签署**:  
- *Motion Architect Signature*: `Hearth Architecture Board (Approved)`  
- *Motion Engineering Lead*: `worker_m1_gen4 (Signed & Verified)`  
- *Independent QA & Audit Guild*: `Teamwork Forensic Auditor (Certified)`
