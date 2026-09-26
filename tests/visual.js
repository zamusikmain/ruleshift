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
      draw();
    },
  },
});
