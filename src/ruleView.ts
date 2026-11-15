import Phaser from "phaser";
import { threatSegment } from "./shared/overdriveHazards";
import { ARENA, C, center } from "./config";
import {
  laserFrame,
  meteorWarning,
  RULE_DEFS,
  shrinkInset,
  symbolPosition,
  type RuleSnapshot,
} from "./shared/ruleEngine";
import { MODIFIER_NAMES } from "./shared/variants";
import { directionVector } from "./shared/direction";
import { t } from "./locales";
import { laserLines } from "./shared/laserHazards";
import { waveRadius } from "./shared/burstHazards";
import { crossSegments } from "./shared/crossfire";
import { effectsLevel } from "./effects";
export const SYMBOLS = ["I", "II", "III"];
export function ruleStatus(s: RuleSnapshot): string {
  const phase=baseRuleStatus(s);
  return s.intensity?`${t('overdriveWaves')} ${Math.max(0,s.intensityRemaining??0).toFixed(1)} · ${phase}`:phase;
}
function baseRuleStatus(s: RuleSnapshot): string {
  const layer=s.overdriveLayers?.[0]??s.overdrive;
  if(layer) return `${t(s.elapsed<layer.warning?"warning":"active")} · ${Math.max(0,s.remaining).toFixed(1)}`;
  if (s.phase === "rest")
    return `${t("next")} · ${Math.max(0, s.remaining).toFixed(1)}`;
  if (s.phase === "announce") return t("prepare");
  if(s.collapse) return `${t(s.elapsed<1.3||s.elapsed>=s.collapse.moveAt&&s.elapsed<s.collapse.finalAt?"warning":"active")} · ${Math.max(0,s.remaining).toFixed(1)}`;
  if(s.crossfire) {
    const phase=s.crossfire.phases.find(p=>s.elapsed<=p.end);
    return `${t(phase&&s.elapsed<phase.active?"warning":"active")} · ${Math.max(0,phase?(s.elapsed<phase.active?phase.active:phase.end)-s.elapsed:s.remaining).toFixed(1)}`;
  }
  if (s.swarmTiles) {
    const phase=s.swarmTiles.phases?.find(p=>s.elapsed>=p.warning&&s.elapsed<p.end);
    const activation=phase?.active??s.swarmTiles.warning;
    return `${t(s.elapsed<activation?"warning":"active")} · ${Math.max(0,s.elapsed<activation?activation-s.elapsed:s.remaining).toFixed(1)}`;
  }
  if (s.burstLayout) return `${t(s.elapsed<s.burstLayout.warning?"warning":"active")} · ${Math.max(0,s.elapsed<s.burstLayout.warning?s.burstLayout.warning-s.elapsed:s.remaining).toFixed(1)}`;
  if (s.laserLayout) return `${t(s.elapsed<s.laserLayout.warning?"warning":"active")} · ${Math.max(0,s.elapsed<s.laserLayout.warning?s.laserLayout.warning-s.elapsed:s.remaining).toFixed(1)}`;
  if (s.event)
    return `${t("overload")} · ${Math.max(0, s.remaining).toFixed(1)}`;
  if (s.ids.includes(4))
    return s.elapsed < 1.8
      ? `${t("stopIn")} ${(1.8 - s.elapsed).toFixed(1)}`
      : s.elapsed < 3.8
        ? `${t("freeze")} ${(3.8 - s.elapsed).toFixed(1)}`
        : t("released");
  if (s.ids.includes(9))
    return `${t("target")} ${SYMBOLS[s.symbol]} · ${Math.max(0, 3.7 - s.elapsed).toFixed(1)}`;
  if (s.ids.includes(2))
    return `${t("center")} · ${Math.max(0, 4 - s.tier * 0.25 - s.elapsed).toFixed(1)}`;
  return `${t(s.elapsed < 1.5 ? "warning" : s.ids.includes(0) ? "moving" : "active")} · ${Math.max(0, s.remaining).toFixed(1)}`;
}
export function ruleTitle(s: RuleSnapshot): string {
  const title=s.ids
    .map(
      (id) =>
        t(RULE_DEFS[id].name) +
        (s.modifiers?.[id] ? " · " + t(MODIFIER_NAMES[s.modifiers[id]!]) : ""),
    )
    .join(" + ");
  return s.intensity?`${t("overdrivePhase")} ${s.intensity} · ${title}`:title;
}
export function ruleSubtitle(s: RuleSnapshot): string {
  if(s.intensity) return t('overdriveHint');
  const kind = s.event
    ? t("overloadHint")
    : s.ids.length > 1
      ? t("sharedWarning")
      : t(RULE_DEFS[s.ids[0]].description, { symbol: SYMBOLS[s.symbol] });
  return kind + (s.ids.includes(5) ? " · " + t(`direction${s.direction}`) : "");
}
export class RuleView {
  private graphics: Phaser.GameObjects.Graphics;
  private symbols: Phaser.GameObjects.Text[];
  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(4);
    this.symbols = SYMBOLS.map((symbol, i) =>
      scene.add
        .text(symbolPosition(i).x, center.y, symbol, {
          fontFamily: "Arial",
          fontSize: 26,
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setDepth(5)
        .setVisible(false),
    );
  }
  draw(s: RuleSnapshot): void {
    const g = this.graphics.clear();
    this.symbols.forEach((text) => text.setVisible(false));
    if (s.phase === "rest") return;
    if(s.comboSafe) for(const q of s.comboSafe) g.lineStyle(2,C.lime,.9).strokeCircle(q.x,q.y,effectsLevel==="high"?20+2*Math.sin(s.elapsed*8):20);
    for(const layout of s.overdriveLayers??(s.overdrive?[s.overdrive]:[])) {
      if(!s.comboSafe) for(const q of layout.safe) g.lineStyle(2,C.lime,.85).strokeCircle(q.x,q.y,20);
      if(layout.kind==='minefield') {
        const mines=layout.threats;
        for(let i=1;i<mines.length;i++) g.lineStyle(1,C.danger,.25).lineBetween(mines[i-1].a.x,mines[i-1].a.y,mines[i].a.x,mines[i].a.y);
      }
      for(const h of layout.threats) {
        if(s.elapsed<h.warning||s.elapsed>h.end) continue;
        const active=s.elapsed>=h.active,l=threatSegment(h,s.elapsed),color=layout.kind==='bulletStorm'?0xffc857:layout.kind==='orbitalStrike'?0xc89bff:layout.kind==='minefield'?0xffa868:h.force!==undefined||layout.kind==='chainLightning'?C.cyan:C.danger;
        const pulse=effectsLevel==='low'?1:.8+.2*Math.sin(s.elapsed*12);
        const speed=Math.hypot(h.velocity.x,h.velocity.y);
        if(speed>0) {
          const x=(l.x1+l.x2)/2,y=(l.y1+l.y2)/2;
          g.lineStyle(2,color,.8).lineBetween(x,y,x+h.velocity.x/speed*18,y+h.velocity.y/speed*18);
        }
        g.lineStyle(active?3:2,color,(active?.95:.55)*pulse);
        if(h.shape==='line') {
          if(active&&effectsLevel!=='low') g.lineStyle(h.radius*2+5,color,.15).lineBetween(l.x1,l.y1,l.x2,l.y2).lineStyle(h.radius*2,color,.8);
          else if(active) g.lineStyle(h.radius*2,color,.85);
          g.lineBetween(l.x1,l.y1,l.x2,l.y2);
          g.fillStyle(color,active?.8:.4).fillCircle(l.x1,l.y1,4).fillCircle(l.x2,l.y2,4);
        } else {
          g.strokeCircle(l.x1,l.y1,h.radius);
          if(active) g.fillStyle(color,h.force!==undefined?.09:.4).fillCircle(l.x1,l.y1,h.radius);
          if(h.force!==undefined) g.lineBetween(l.x1-8,l.y1,l.x1+8,l.y1).lineBetween(l.x1,l.y1-8,l.x1,l.y1+8);
        }
      }
    }
    if(s.collapse) {
      const layout=s.collapse;
      const safe=s.elapsed<layout.moveAt?layout.safe:[layout.destination];
      for(const q of safe) g.lineStyle(2,C.lime,.9).strokeCircle(q.x,q.y,20);
      if(s.elapsed>=layout.moveAt&&s.elapsed<layout.finalAt) for(const q of layout.safe)
        g.lineStyle(2,C.lime,.4).lineBetween(q.x,q.y,layout.destination.x,layout.destination.y);
      for(const tile of layout.tiles) {
        if(s.elapsed<tile.born) continue;
        const active=s.elapsed>=tile.active;
        g.fillStyle(C.danger,active?.5:.1+.08*Math.sin(s.elapsed*14)).fillRect(tile.x,tile.y,tile.width,tile.height);
        g.lineStyle(active?2:1,C.danger,active?.8:.4).strokeRect(tile.x+2,tile.y+2,tile.width-4,tile.height-4);
      }
    }
    if(s.crossfire) {
      for(const phase of s.crossfire.phases) if(s.elapsed>=phase.warning&&s.elapsed<phase.active)
        for(const q of phase.safe) g.lineStyle(2,C.lime,.8).strokeCircle(q.x,q.y,20);
      for(const a of s.crossfire.attacks) {
        const phase=s.crossfire.phases.find(p=>a.active>=p.active&&a.active<=p.end)!;
        if(s.elapsed<phase.warning||s.elapsed>a.end) continue;
        const warning=s.elapsed<a.active;
        for(const line of crossSegments(a,warning?a.active:s.elapsed)) {
          // Place warnings just inside the attacking edge, matching direction.
          const dx=warning?(a.direction==="LEFT"?34:a.direction==="RIGHT"?-34:0):0;
          const dy=warning?(a.direction==="TOP"?34:a.direction==="BOTTOM"?-34:0):0;
          if(effectsLevel!=="low") g.lineStyle(a.width+8,C.danger,warning?.08:.15).lineBetween(line.x1+dx,line.y1+dy,line.x2+dx,line.y2+dy);
          g.lineStyle(warning?2:a.width,C.danger,warning?.6:1).lineBetween(line.x1+dx,line.y1+dy,line.x2+dx,line.y2+dy);
        }
      }
    }
    if(s.swarmTiles) {
      const layout=s.swarmTiles,warning=s.elapsed<layout.warning;
      const phase=layout.phases?.find(p=>s.elapsed>=p.warning&&s.elapsed<p.end);
      for(const q of phase?.safe??(layout.phases?[]:layout.safe)) g.lineStyle(2,C.lime,.6).strokeCircle(q.x,q.y,layout.refugeRadius);
      for(const h of layout.hunters) {
        const color=h.model==="chase"?C.danger:h.model==="intercept"?C.cyan:C.lime;
        g.lineStyle(2,color,warning?.4+.2*Math.sin(s.elapsed*12):.9).strokeCircle(h.x,h.y,warning?h.radius+12:h.radius+5);
        if(!warning) {
          g.lineStyle(3,color,.25).lineBetween(h.previous.x,h.previous.y,h.x,h.y);
          g.fillStyle(color,.8).fillCircle(h.x,h.y,h.radius);
        }
      }
      for(const tile of layout.tiles) {
        if(s.elapsed<tile.born || s.elapsed>=tile.end) continue;
        const active=s.elapsed>=tile.active;
        g.fillStyle(C.danger,active?.4:.1+.08*Math.sin(s.elapsed*15)).fillRect(tile.x,tile.y,tile.width,tile.height);
        g.lineStyle(active?3:1,C.danger,active?.9:.5).strokeRect(tile.x+2,tile.y+2,tile.width-4,tile.height-4);
      }
    }
    if (s.burstLayout) {
      const layout=s.burstLayout;
      if(s.elapsed<layout.warning) for(const p of layout.safe)
        g.lineStyle(2,C.lime,.8).strokeCircle(p.x,p.y,20);
      for(const e of layout.explosions) {
        if(s.elapsed<e.born || s.elapsed>e.impact+e.duration) continue;
        const warning=s.elapsed<e.impact;
        const progress=Math.max(0,Math.min(1,(s.elapsed-e.born)/(e.impact-e.born)));
        g.lineStyle(e.secondary?3:2,e.secondary?C.cyan:C.danger,warning?.45+.35*progress:1).strokeCircle(e.x,e.y,e.radius);
        if(warning) {
          g.lineStyle(3,C.danger,.7).lineBetween(e.x,e.y-80*(1-progress)-8,e.x,e.y-80*(1-progress)+8);
          g.lineStyle(1,C.danger,.6).strokeCircle(e.x,e.y,e.radius*(1-progress));
        } else g.fillStyle(C.danger,.25*(1-(s.elapsed-e.impact)/e.duration)).fillCircle(e.x,e.y,e.radius);
      }
      for(const w of layout.waves) {
        if(s.elapsed<w.born || s.elapsed>w.impact+(w.outer-w.inner)/w.speed) continue;
        const warning=s.elapsed<w.impact,r=waveRadius(w,s.elapsed);
        const start=w.gap+w.halfGap,end=w.gap+Math.PI*2-w.halfGap;
        if(effectsLevel!=="low") g.lineStyle(w.width+8,C.cyan,warning?.05:.14).beginPath().arc(w.x,w.y,r,start,end,false).strokePath();
        g.lineStyle(warning?2:w.width,C.cyan,warning?.4:1).beginPath().arc(w.x,w.y,r,start,end,false).strokePath();
        if(warning) for(const a of [w.gap-w.halfGap,w.gap+w.halfGap])
          g.lineStyle(1,C.lime,.35).lineBetween(w.x+Math.cos(a)*w.inner,w.y+Math.sin(a)*w.inner,w.x+Math.cos(a)*w.outer,w.y+Math.sin(a)*w.outer);
      }
    }
    if (s.laserLayout && s.elapsed<s.duration-0.25) {
      const layout=s.laserLayout, warning=s.elapsed<layout.warning;
      for (const l of laserLines(layout,s.elapsed)) {
        if(effectsLevel!=="low") g.lineStyle(layout.width+8,C.danger,warning?0.08:0.16).lineBetween(l.x1,l.y1,l.x2,l.y2);
        g.lineStyle(warning?2:layout.width,C.danger,warning?0.5+0.2*Math.sin(s.elapsed*12):1).lineBetween(l.x1,l.y1,l.x2,l.y2);
      }
      if (warning) for (const p of layout.safe)
        g.lineStyle(2,C.lime,0.8).strokeCircle(p.x,p.y,20);
      if (layout.kind==="spin") g.lineStyle(2,C.cyan,0.6).strokeCircle(layout.pivot.x,layout.pivot.y,layout.inner-20);
    }
    if (s.ids.includes(5)) {
      const beam = laserFrame(s);
      if (beam.active || beam.warning) {
        g.lineStyle(
          beam.active ? 8 : 3,
          C.danger,
          beam.active ? 1 : 0.65,
        ).lineBetween(beam.x1, beam.y1, beam.x2, beam.y2);
        if (beam.warning) {
          const v = directionVector(beam.direction);
          for (const p of [0.2, 0.5, 0.8]) {
            const x = beam.x1 + (beam.x2 - beam.x1) * p,
              y = beam.y1 + (beam.y2 - beam.y1) * p;
            g.lineStyle(3, C.danger).lineBetween(
              x,
              y,
              x + v.x * 24,
              y + v.y * 24,
            );
            g.lineBetween(
              x + v.x * 24,
              y + v.y * 24,
              x + v.x * 14 + v.y * 8,
              y + v.y * 14 - v.x * 8,
            );
            g.lineBetween(
              x + v.x * 24,
              y + v.y * 24,
              x + v.x * 14 - v.y * 8,
              y + v.y * 14 + v.x * 8,
            );
          }
        }
      }
    }
    if (s.phase !== "active") return;
    for (const h of s.hazards) {
      const active =
        h.kind === "shot" ||
        (h.kind === "meteor"
          ? s.elapsed - h.born >= meteorWarning(s)
          : s.elapsed >= (s.comboSafe?2:1.5));
      if (h.kind === "zone" && s.elapsed >= s.duration - 0.3) continue;
      g.fillStyle(C.danger, active ? 0.23 : 0.07).fillCircle(
        h.x,
        h.y,
        h.radius,
      );
      g.lineStyle(active ? 3 : 1, C.danger, active ? 1 : 0.6).strokeCircle(
        h.x,
        h.y,
        h.radius,
      );
      if (h.kind === "shot")
        g.fillStyle(0xffdfe5)
          .fillCircle(h.x, h.y, 3)
          .lineStyle(3, C.danger, 0.3)
          .lineBetween(h.x, h.y, h.x - h.vx * 0.08, h.y - h.vy * 0.08);
      else
        g.lineStyle(2, C.danger, 0.8)
          .lineBetween(h.x - 6, h.y - 6, h.x + 6, h.y + 6)
          .lineBetween(h.x + 6, h.y - 6, h.x - 6, h.y + 6);
    }
    if (s.ids.includes(2) && s.elapsed < 4 - s.tier * 0.25) {
      g.fillStyle(C.cyan, 0.12)
        .fillCircle(center.x, center.y, 86)
        .lineStyle(2, C.cyan)
        .strokeCircle(center.x, center.y, 86);
      g.lineStyle(5, C.cyan)
        .beginPath()
        .arc(
          center.x,
          center.y,
          96,
          -Math.PI / 2,
          -Math.PI / 2 +
            Math.PI * 2 * Math.max(0, 1 - s.elapsed / (4 - s.tier * 0.25)),
          false,
        )
        .strokePath();
    }
    if (s.ids.includes(6)) {
      const inset = shrinkInset(s);
      g.fillStyle(C.danger, 0.15)
        .fillRect(ARENA.left, ARENA.top, inset, ARENA.bottom - ARENA.top)
        .fillRect(
          ARENA.right - inset,
          ARENA.top,
          inset,
          ARENA.bottom - ARENA.top,
        )
        .fillRect(
          ARENA.left + inset,
          ARENA.top,
          ARENA.right - ARENA.left - inset * 2,
          inset * 0.6,
        )
        .fillRect(
          ARENA.left + inset,
          ARENA.bottom - inset * 0.6,
          ARENA.right - ARENA.left - inset * 2,
          inset * 0.6,
        );
      g.lineStyle(2, C.danger, 0.8).strokeRect(
        ARENA.left + inset,
        ARENA.top + inset * 0.6,
        ARENA.right - ARENA.left - inset * 2,
        ARENA.bottom - ARENA.top - inset * 1.2,
      );
    }
    if (s.ids.includes(9) && s.elapsed < 3.7)
      for (let i = 0; i < 3; i++) {
        const pos = symbolPosition(i),
          color = [C.cyan, C.lime, 0xc49bff][i];
        g.fillStyle(color, 0.1)
          .fillCircle(pos.x, pos.y, 80)
          .lineStyle(2, color)
          .strokeCircle(pos.x, pos.y, 80);
        this.symbols[i].setVisible(true);
      }
  }
}
