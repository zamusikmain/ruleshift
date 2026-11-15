// Local-only renderer/DOM fixture. Vite's production entry does not import this file.
// This is not a WebSocket or Cloudflare end-to-end test.
import Phaser from "phaser";
import "../src/style.css";
import { WIDTH, HEIGHT } from "../src/config";
import { drawArena } from "../src/arena";
import { RuleEngine } from "../src/shared/ruleEngine";
import { RuleView } from "../src/ruleView";
import { UnifiedInput } from "../src/input";
import { FeatureView, showAbilities } from "../src/featureView";
import { createBody } from "../src/shared/movement";
import { Room } from "../src/shared/room";
import { OnlineClient } from "../src/online/client";
import { clearMenu, updateChrome } from "../src/ui";
import { getLocale, setLocale } from "../src/locales";
import { seededRandom } from "../src/shared/offlineProgress";
import { setEffects } from "../src/effects";
import { showHud } from "../src/hud";
import { createPlayerView } from "../src/playerView";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: WIDTH,
  height: HEIGHT,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  audio: { noAudio: true },
  input: { touch: false, mouse: false },
  scene: {
    create() {
      document.querySelector("#qa-controls").style.flexWrap="wrap";
      updateChrome();
      drawArena(this);
      const controls = new UnifiedInput(this),
        rules = new RuleEngine(),
        view = new RuleView(this),
        features = new FeatureView(this);
      const body = {
        ...createBody(),
        id: "qa",
        shield: true,
        speedTime: 5,
        shockwave: true,
      };
      const room = new Room("QA2345");
      room.join("a", "a", "Alpha", 0);
      room.join("b", "b", "Beta", 1);
      const client = new OnlineClient(
        this,
        controls,
        () => {
          clearMenu();
        },
        () => {},
      );
      client.id = "a";
      client.socket = {
        readyState: WebSocket.OPEN,
        close() {},
        send(raw) {
          room.command("a", JSON.parse(raw));
          client.receive(room.snapshot());
        },
      };
      const draw = () => {
        clearMenu();
        document.body.classList.add("playing");
        controls.setEnabled(true);
        view.draw(rules.state);
        features.draw(
          ["shield", "speed", "heal", "scoreBoost", "shockwave"].map(
            (kind, i) => ({
              id: i + 1,
              kind,
              x: 360 + i * 110,
              y: 440,
              ttl: 8,
            }),
          ),
          [body],
          "qa",
          0,
        );
        showAbilities(body);
      };
      Object.assign(rules.state, {
        phase: "announce",
        ids: [5],
        duration: 6,
        elapsed: 0,
      });
      for (const button of document.querySelectorAll("[data-direction]"))
        button.onclick = () => {
          Object.assign(rules.state, {
            direction: button.dataset.direction,
            phase: "announce",
            elapsed: 0,
          });
          draw();
        };
      document.querySelector("#qa-active").onclick = () => {
        Object.assign(rules.state, { phase: "active", elapsed: 3.4 });
        draw();
      };
      document.querySelector("#qa-results").onclick = () => {
        view.draw({ ...rules.state, phase: "rest" });
        features.hide();
        room.phase = "results";
        room.winnerId = "a";
        room.matchId = 0;
        room.time = 0;
        Object.assign(room.members.get("a").state, {
          placement: 1,
          perfects: 8,
          nearMisses: 5,
          damageTaken: 2,
          pickups: 6,
        });
        Object.assign(room.members.get("b").state, {
          placement: 2,
          hp: 0,
          eliminatedAt: 0,
        });
        client.renderKey = "";
        client.receive(room.snapshot());
      };
      document.querySelector("#qa-language").onclick = () =>
        setLocale(getLocale() === "ru" ? "en" : "ru");
      let gallery,animated=false,elapsed=0;
      const actors=Array.from({length:8},(_,i)=>({...createBody(580+120*Math.cos(i*Math.PI/4),399+80*Math.sin(i*Math.PI/4)),id:`qa${i}`}));
      actors.forEach((p,i)=>createPlayerView(this,p.x,p.y,i));
      const renderGallery=()=>{
        clearMenu();document.body.classList.add("playing");
        view.draw(gallery.state);showHud(3,0,elapsed,gallery.state,0,8);
      };
      const selectGallery=()=>{
        gallery=new RuleEngine(seededRandom(123),"chaos");
        gallery.state.ids=document.querySelector("#qa-hazard").value.split(",").map(Number);
        gallery.state.tier=2;gallery.start(actors);
        gallery.state.elapsed=.2;elapsed=.2;renderGallery();
      };
      document.querySelector("#qa-hazard").onchange=selectGallery;
      document.querySelector("#qa-warning").onclick=()=>{animated=false;selectGallery();};
      document.querySelector("#qa-impact").onclick=()=>{if(!gallery)selectGallery();animated=false;gallery.state.elapsed=2.8;gallery.state.remaining=gallery.state.duration-2.8;renderGallery();};
      document.querySelector("#qa-effects").onchange=()=>setEffects(document.querySelector("#qa-effects").value);
      document.querySelector("#qa-animate").onclick=()=>{if(!gallery)selectGallery();animated=!animated;};
      let frames=0,frameTime=0,worst=0,slow=0,renderTime=0;
      this.events.on(Phaser.Scenes.Events.POST_UPDATE,(_time,delta)=>{
        frames++;frameTime+=delta;worst=Math.max(worst,delta);if(delta>50)slow++;
        if(gallery&&animated) {
          const start=performance.now();elapsed+=Math.min(.05,delta/1000);
          if(elapsed>=gallery.state.duration)elapsed=.2;
          gallery.state.elapsed=elapsed;gallery.state.remaining=gallery.state.duration-elapsed;
          renderGallery();renderTime+=performance.now()-start;
        }
        if(frameTime>=2000) {
          document.querySelector("#qa-metrics").textContent=JSON.stringify({fixture:true,players:8,ids:gallery?.state.ids,fps:+(frames*1000/frameTime).toFixed(1),maxFrameMs:+worst.toFixed(1),framesOver50ms:slow,renderMs:+(renderTime/frames).toFixed(2),heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,objects:this.children.length});
          frames=0;frameTime=0;worst=0;slow=0;renderTime=0;
        }
      });
      draw();
    },
  },
});
