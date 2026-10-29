import { useEffect, useId, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import './EmberPresence.css';

gsap.registerPlugin(useGSAP);

export interface EmberPresenceProps {
  band?: 'cool' | 'warm' | 'hot';
  scene?: string;
  compact?: boolean;
  paused?: boolean;
  className?: string;
}

/** Each state has its own authored contour; the quiet ember is not a scaled flame. */
const contours = {
  cool: {
    mantle: 'M93 168C75 169 63 159 66 145C68 134 78 131 76 116C88 121 88 129 91 136C97 128 102 122 100 108C117 121 124 136 119 150C115 162 106 169 93 168Z',
    left: 'M80 161C69 157 63 148 68 137C71 131 77 127 76 118C86 129 79 136 85 142C91 149 91 157 80 161Z',
    right: 'M104 165C113 157 119 151 117 140C114 133 112 130 113 122C125 134 130 149 120 159C116 164 109 165 104 165Z',
    inner: 'M93 163C82 159 81 150 86 144C91 138 94 133 93 126C106 137 112 147 106 156C103 161 98 164 93 163Z',
    ribbon: 'M79 151C82 143 78 133 78 127C86 136 84 144 89 151C85 147 83 148 79 151Z',
    filament: 'M103 130C112 140 116 149 109 157',
    heart: 'M95 161C90 157 89 152 94 145C95 150 102 153 100 157C99 160 97 161 95 161Z',
  },
  warm: {
    mantle: 'M94 170C69 172 54 156 58 138C61 122 75 115 74 98C74 84 67 77 71 65C79 80 95 81 99 96C107 79 111 66 104 49C129 66 139 86 130 106C124 119 126 127 132 134C144 152 125 169 108 170Z',
    left: 'M77 164C57 157 51 140 60 127C64 121 69 117 70 108C79 114 74 124 80 133C85 141 87 156 77 164Z',
    right: 'M108 166C124 153 113 142 121 127C125 119 134 113 133 102C148 119 143 133 137 144C132 157 121 165 108 166Z',
    inner: 'M95 166C77 163 74 151 80 137C85 126 96 118 94 104C99 110 104 113 108 124C115 115 118 108 117 99C129 115 124 132 118 145C114 159 104 166 95 166Z',
    ribbon: 'M71 145C69 132 83 123 80 111C78 101 75 95 76 89C87 104 94 112 87 127C83 136 79 138 79 150C76 145 74 144 71 145Z',
    filament: 'M111 68C121 85 113 98 109 106C106 113 109 118 112 122',
    heart: 'M96 163C87 161 85 152 91 143C96 136 98 131 97 124C107 133 111 144 106 154C103 160 100 163 96 163Z',
  },
  hot: {
    mantle: 'M91 171C64 172 48 155 54 134C59 116 76 108 72 89C70 77 61 68 65 54C71 66 83 67 87 79C92 66 104 54 100 36C98 26 93 23 95 15C116 27 129 44 126 65C124 78 116 86 119 99C129 88 134 76 130 63C151 82 151 105 139 121C137 125 138 129 142 134C158 153 134 171 110 173Z',
    left: 'M77 166C59 166 43 152 48 137C51 127 60 124 60 111C67 117 68 124 66 133C65 140 76 144 79 153C82 160 80 164 77 166Z',
    right: 'M112 169C126 157 119 147 128 134C134 126 145 121 146 109C159 123 153 137 148 144C143 152 143 158 134 164C127 168 120 170 112 169Z',
    inner: 'M94 167C75 165 68 153 74 139C79 127 91 123 91 109C91 100 87 95 89 87C95 94 102 99 104 109C113 98 117 87 113 75C132 96 126 116 119 132C117 137 118 144 115 152C111 162 102 168 94 167Z',
    ribbon: 'M66 145C61 132 79 118 80 108C83 94 71 86 71 76C80 84 93 91 91 107C89 121 77 133 77 145C73 141 70 141 66 145Z',
    filament: 'M105 37C122 57 107 73 106 87C105 96 110 101 112 109',
    heart: 'M96 164C85 163 82 153 88 143C93 134 101 128 98 117C112 130 114 141 107 153C104 159 101 164 96 164Z',
  },
};

export function EmberPresence({ band = 'cool', scene = 'rest', compact = false, paused = false, className = '' }: EmberPresenceProps) {
  const unique = useId().replace(/:/g, '');
  const root = useRef<HTMLDivElement>(null);
  const ignition = useRef<ReturnType<typeof gsap.timeline> | null>(null);
  const ambient = useRef<ReturnType<typeof gsap.timeline> | null>(null);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const shape = contours[band];
  const id = (name: string) => `${unique}-${name}`;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    update(); visibility();
    media.addEventListener('change', update);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      media.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useGSAP(() => {
    const node = root.current;
    if (!node || !['ignite', 'rekindle', 'enter'].includes(scene)
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const select = gsap.utils.selector(node);
    const duration = scene === 'rekindle' ? 1.1 : .86;
    const timeline = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
    timeline.addLabel('core', 0).addLabel('wings', .12).addLabel('mantle', .24);
    timeline.fromTo(select('.ember-presence__inner-stage'),
      { opacity: .22, y: 7, scaleY: .66 },
      { opacity: 1, y: 0, scaleY: 1, duration: duration * .68 }, 'core');
    timeline.fromTo(select('.ember-presence__left-stage, .ember-presence__right-stage'),
      { opacity: .18, y: 8, scaleY: .62 },
      { opacity: 1, y: 0, scaleY: 1, duration: duration * .67, stagger: .055 }, 'wings');
    timeline.fromTo(select('.ember-presence__mantle-stage'),
      { opacity: .2, y: 9, scaleY: .58 },
      { opacity: 1, y: 0, scaleY: 1, duration: duration - .24 }, 'mantle');
    ignition.current = timeline;
    if (node.dataset.still !== 'true') timeline.play();
    return () => { ignition.current = null; };
  }, { scope: root, dependencies: [scene, band], revertOnUpdate: true });

  useGSAP(() => {
    const node = root.current;
    if (!node || reduced) return;
    const select = gsap.utils.selector(node);
    gsap.set(select('.ember-presence__mantle'), { attr: { d: contours[band].mantle } });
    const timeline = gsap.timeline({ paused: true, defaults: { ease: 'sine.inOut', repeat: -1, yoyo: true } });
    timeline.addLabel('breath', 0).addLabel('tongue', .18).addLabel('cinders', .46);
    timeline.to(select('.ember-presence__seam-bloom'), { opacity: band === 'cool' ? .62 : .84, duration: 4.1 }, 'breath');
    if (band !== 'cool') {
      // Ambient movement acts on paths; ignition acts on their parent stages.
      timeline.to(select('.ember-presence__mantle, .ember-presence__filament'), { skewX: 1.4, scaleY: 1.018, svgOrigin: '96 166', duration: 1.9 }, 'breath');
      timeline.to(select('.ember-presence__left'), { rotation: 1.2, scaleY: 1.025, svgOrigin: '80 163', duration: 2.35 }, 'tongue');
      timeline.to(select('.ember-presence__ribbon'), { skewX: -1.1, scaleY: 1.03, svgOrigin: '80 163', duration: 2.08 }, 'tongue+=.43');
      timeline.to(select('.ember-presence__right'), { rotation: -1.2, scaleY: .98, svgOrigin: '115 165', duration: 1.65 }, 'tongue+=.26');
      timeline.to(select('.ember-presence__inner'), { skewX: -1.2, scaleY: 1.025, svgOrigin: '96 165', duration: 1.45 }, 'tongue+=.65');
      timeline.to(select('.ember-presence__heart'), { scaleY: 1.035, svgOrigin: '96 164', duration: 1.7 }, 'tongue+=.92');
      timeline.to(select('.ember-presence__halo'), { scale: 1.025, svgOrigin: '96 162', duration: 3.5 }, 'breath');
      const bentContour = band === 'hot'
        ? 'M91 171C64 172 49 154 54 134C58 115 78 106 75 88C73 76 64 67 67 52C73 64 85 66 89 78C94 64 106 52 104 35C102 25 97 23 99 15C118 28 131 45 127 66C124 80 115 87 119 99C129 89 136 77 133 64C152 84 150 106 138 122C136 127 138 130 142 134C158 153 134 171 110 173Z'
        : 'M94 170C69 172 54 156 58 138C61 121 77 115 77 98C77 84 70 77 73 64C81 79 97 81 100 96C108 78 114 66 108 49C131 66 140 87 131 107C125 120 126 127 132 134C144 152 125 169 108 170Z';
      timeline.to(select('.ember-presence__mantle'), { attr: { d: bentContour }, duration: band === 'hot' ? 1.55 : 2.45 }, 'tongue');
      for (let index = 0; index < 3; index++) {
        const cinder = select('.ember-presence__cinder')[index];
        if (!cinder) continue;
        const drift = gsap.timeline({ repeat: -1, repeatDelay: 1 + index * .4 });
        drift.fromTo(cinder, { opacity: 0, y: 3, x: 0, scale: .65 }, { opacity: .6, y: -1, scale: 1, duration: .6, ease: 'sine.out' })
          .to(cinder, { opacity: 0, y: -14, x: 3, scale: .3, duration: 2.3 + index * .4, ease: 'sine.out' });
        timeline.add(drift, `cinders+=${index * 1.1}`);
      }
    }
    ambient.current = timeline;
    if (node.dataset.still !== 'true') timeline.play();
    return () => { ambient.current = null; };
  }, { scope: root, dependencies: [band, reduced], revertOnUpdate: true });

  useEffect(() => {
    if (reduced) ignition.current?.progress(1).pause();
    else ignition.current?.paused(paused || hidden);
    ambient.current?.paused(paused || hidden || reduced);
  }, [paused, reduced, hidden]);

  return (
    <div ref={root} className={`ember-presence${compact ? ' ember-presence--compact' : ''} ${className}`} data-motion-engine="gsap" data-band={band} data-scene={scene} data-still={paused || reduced || hidden} aria-hidden="true">
      <svg className="ember-presence__art" viewBox="0 0 192 216" fill="none" focusable="false">
        <defs>
          <linearGradient id={id('mantle')} x1="104" y1="34" x2="95" y2="174" gradientUnits="userSpaceOnUse"><stop stopColor="#F6CF9B" stopOpacity=".74"/><stop offset=".34" stopColor="#EC954C" stopOpacity=".82"/><stop offset=".71" stopColor="#D75D27"/><stop offset="1" stopColor="#94391C" stopOpacity=".18"/></linearGradient>
          <linearGradient id={id('side')} x1="92" y1="79" x2="88" y2="171" gradientUnits="userSpaceOnUse"><stop stopColor="#FFC88A" stopOpacity=".8"/><stop offset=".55" stopColor="#DD6B32" stopOpacity=".82"/><stop offset="1" stopColor="#A84722" stopOpacity=".12"/></linearGradient>
          <linearGradient id={id('inner')} x1="105" y1="76" x2="94" y2="166" gradientUnits="userSpaceOnUse"><stop stopColor="#FFF4D7"/><stop offset=".42" stopColor="#FFD592"/><stop offset=".9" stopColor="#F5A04C" stopOpacity=".9"/><stop offset="1" stopColor="#E9873B" stopOpacity=".12"/></linearGradient>
          <linearGradient id={id('ribbon')} x1="88" y1="82" x2="77" y2="154" gradientUnits="userSpaceOnUse"><stop stopColor="#FFF4D3" stopOpacity=".05"/><stop offset=".46" stopColor="#FFEAC0" stopOpacity=".68"/><stop offset="1" stopColor="#F5AC62" stopOpacity="0"/></linearGradient>
          <linearGradient id={id('heart')} x1="99" y1="119" x2="97" y2="166" gradientUnits="userSpaceOnUse"><stop stopColor="#FFFBEA"/><stop offset=".58" stopColor="#FFEDC1"/><stop offset="1" stopColor="#FFB34E"/></linearGradient>
          <linearGradient id={id('coal')} x1="80" y1="162" x2="102" y2="193" gradientUnits="userSpaceOnUse"><stop stopColor="#77513F"/><stop offset=".36" stopColor="#45372D"/><stop offset="1" stopColor="#282A24"/></linearGradient>
          <linearGradient id={id('seam')} x1="97" y1="164" x2="97" y2="186" gradientUnits="userSpaceOnUse"><stop stopColor="#FFCF78"/><stop offset=".5" stopColor="#DB7438"/><stop offset="1" stopColor="#BA512A" stopOpacity=".1"/></linearGradient>
          <radialGradient id={id('aura')}><stop stopColor="#F1B36E" stopOpacity=".24"/><stop offset=".42" stopColor="#EFB27D" stopOpacity=".08"/><stop offset="1" stopColor="#EFB27D" stopOpacity="0"/></radialGradient>
          <filter id={id('glow')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
        </defs>
        <path className="ember-presence__ground" d="M47 187C67 181 126 181 148 187C134 195 69 197 47 187Z" fill="#71624B" opacity=".065"/>
        <path className="ember-presence__halo" d="M19 134C19 90 54 47 97 47C140 47 174 90 174 134C174 178 140 207 97 207C54 207 19 178 19 134Z" fill={`url(#${id('aura')})`}/>
        <g className="ember-presence__reveal ember-presence__mantle-stage"><path className="ember-presence__mantle" d={shape.mantle} fill={`url(#${id('mantle')})`}/><path className="ember-presence__filament" d={shape.filament} stroke="#FFF0C8" strokeWidth=".65" strokeLinecap="round" strokeOpacity=".52"/></g>
        <g className="ember-presence__reveal ember-presence__left-stage"><path className="ember-presence__left" d={shape.left} fill={`url(#${id('side')})`}/></g>
        <g className="ember-presence__reveal ember-presence__right-stage"><path className="ember-presence__right" d={shape.right} fill={`url(#${id('side')})`}/></g>
        <g className="ember-presence__reveal ember-presence__inner-stage"><path className="ember-presence__ribbon" d={shape.ribbon} fill={`url(#${id('ribbon')})`}/><path className="ember-presence__inner" d={shape.inner} fill={`url(#${id('inner')})`}/><path className="ember-presence__heart" d={shape.heart} fill={`url(#${id('heart')})`}/></g>
        <g className="ember-presence__coal">
          <path d="M61 170L72 160L91 158L106 162L124 166L132 177L118 188L96 193L73 188L58 181Z" fill={`url(#${id('coal')})`}/>
          <path d="M61 170L72 160L91 158L85 168L70 174Z" fill="#A07958" opacity=".65"/>
          <path d="M91 158L106 162L111 172L94 174L85 168Z" fill="#B67B50" opacity=".5"/>
          <path d="M106 162L124 166L132 177L114 178L111 172Z" fill="#645344"/>
          <path d="M70 174L85 168L94 174L89 187L73 188L58 181Z" fill="#342D25" opacity=".78"/>
          <path d="M94 174L111 172L114 178L118 188L96 193L89 187Z" fill="#554032" opacity=".76"/>
          <path d="M114 178L132 177L118 188Z" fill="#242923"/>
          <path d="M65 177L69 176M74 168L78 167M77 180L81 182M95 165L99 166M103 176L107 177M111 185L114 184M118 171L121 173M83 188L86 189" stroke="#DAC19A" strokeOpacity=".2" strokeWidth=".65" strokeLinecap="round"/>
          <path d="M72 161L82 163L89 161M63 173L70 174L72 181M99 188L101 183L110 182M121 170L125 176" stroke="#BD9E79" strokeOpacity=".27" strokeWidth=".7" strokeLinecap="round"/>
          <path className="ember-presence__seam-bloom" d="M91 160L85 168L94 174L89 187M94 174L111 172L114 178M70 174L85 168" stroke={`url(#${id('seam')})`} strokeWidth="3" filter={`url(#${id('glow')})`}/>
          <path className="ember-presence__seam" d="M91 160L85 168L94 174L89 187M94 174L111 172L114 178M70 174L85 168" stroke={`url(#${id('seam')})`} strokeWidth=".85" strokeLinecap="round"/>
          <path d="M72 161L91 158L106 162L124 166" stroke="#D6B78A" strokeOpacity=".45" strokeWidth=".65" strokeLinecap="round"/>
          <path d="M62 184L69 183L72 187L66 189Z" fill="#B4A28A" opacity=".38"/>
          <path d="M122 185L128 181L132 183L129 186Z" fill="#A2947C" opacity=".4"/>
        </g>
        <g className="ember-presence__cinders" fill="#E7A04D"><path className="ember-presence__cinder ember-presence__cinder--one" d="M85 151L86 148L87 151L86 153Z"/><path className="ember-presence__cinder ember-presence__cinder--two" d="M111 145L112 142L113 145L112 147Z"/><path className="ember-presence__cinder ember-presence__cinder--three" d="M98 133L99 131L100 134L99 135Z"/></g>
      </svg>
    </div>
  );
}
