import Phaser from 'phaser';
import './style.css';
import { WIDTH, HEIGHT } from './config';
import { ArenaScene } from './scenes/ArenaScene';
new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: WIDTH, height: HEIGHT,
  backgroundColor: '#0b131e', antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [ArenaScene], audio: { noAudio: true },
});
