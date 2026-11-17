import Phaser from 'phaser';
import { COLORS } from '../config/constants.js';
import { layout } from '../config/layout.js';
import { profileStore } from '../config/profileStore.js';
import { settingsStore } from '../config/settingsStore.js';
import { localSeatsFor, seatsFor } from '../game/settings.js';
import { Avatar } from '../objects/Avatar.js';
import { ImageButton } from '../objects/ImageButton.js';
import { addBackground } from '../ui/background.js';
import { ProfileDialog } from '../ui/ProfileDialog.js';
import { avatarForName } from '../ui/profileAvatar.js';
import { SetupDialog } from '../ui/SetupDialog.js';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

const TOKEN_COLORS = [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue];

// Splash page: title and the four game-mode buttons, plus the Settings button in the top right corner.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const m = layout.menu;
    const cx = layout.width / 2;
    addBackground(this);
    this.addBackdrop();

    addText(this, cx, m.titleY, 'LUDO', { fontSize: `${m.titleFont}px`, color: '#ffffff' }).setOrigin(0.5);
    addText(this, cx, m.subtitleY, 'The classic race home', { fontSize: `${m.subtitleFont}px`, color: UI.muted }).setOrigin(0.5);

    const modes = [
      { textureKey: 'btn-computer', label: 'Player vs Computer', onClick: () => this.openSetup('computer') },
      { textureKey: 'btn-local', label: 'Local Multiplayer', onClick: () => this.openSetup('local') },
      { textureKey: 'btn-online', label: 'Play Online', onClick: () => this.openSetup('online') },
      { textureKey: 'btn-friends', label: 'With Friends', onClick: () => this.scene.start('OnlineScene', { intent: 'friends' }) },
    ];
    modes.forEach((mode, i) => new ImageButton(this, m.buttonXs[i], m.buttonYs[i], { ...mode, tileW: m.buttonW, tileH: m.tileH, cellH: m.buttonH, labelFont: m.labelFont, labelLines: m.labelLines, labelWrap: m.labelWrap }));

    // Settings: just the picture, in the top right corner.
    new ImageButton(this, m.settingsX, m.settingsY, {
      textureKey: 'btn-settings',
      tileW: m.settingsW,
      tileH: m.settingsH,
      cellH: m.settingsH,
      onClick: () => this.scene.start('SettingsScene'),
    });
    this.buildProfileChip();
  }

  // Your avatar and name in the top left corner; tapping it opens the popup where the name can be changed.
  buildProfileChip() {
    this.chip?.forEach((item) => item.destroy());
    const c = layout.menu.profile;
    const name = profileStore.name();
    const left = c.x - c.w / 2;
    const items = [];
    const bg = this.add.graphics();
    bg.fillStyle(UI.panel, 0.95).fillRoundedRect(left, c.y - c.h / 2, c.w, c.h, c.h / 2);
    bg.lineStyle(2, UI.border, 1).strokeRoundedRect(left, c.y - c.h / 2, c.w, c.h, c.h / 2);
    items.push(bg);
    const key = avatarForName(name);
    if (key && this.textures.exists(key)) items.push(new Avatar(this, left + c.pad + c.avatar / 2, c.y, { textureKey: key, size: c.avatar - 8, color: UI.accent }).setTurn(true));
    items.push(addText(this, left + c.pad * 2 + c.avatar, c.y, name, { fontSize: `${c.font}px`, color: '#ffffff' }).setOrigin(0, 0.5));
    const hit = this.add.rectangle(c.x, c.y, c.w, c.h, 0x000000, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.openProfile());
    items.push(hit);
    this.chip = items;
  }

  openProfile() {
    if (this.setup || this.profile) return;
    this.profile = new ProfileDialog(this, {
      name: profileStore.name(),
      onSave: (name) => {
        this.profile = null;
        profileStore.setName(name);
        this.buildProfileChip();
      },
      onCancel: () => {
        this.profile = null;
      },
    });
  }

  // Floating coloured tokens behind the menu.
  addBackdrop() {
    for (let i = 0; i < 16; i++) {
      const dot = this.add
        .circle(
          Phaser.Math.Between(20, layout.width - 20),
          Phaser.Math.Between(20, layout.height - 20),
          Phaser.Math.Between(14, 34),
          TOKEN_COLORS[i % 4],
          0.18,
        )
        .setDepth(-1);
      this.tweens.add({
        targets: dot,
        y: dot.y + Phaser.Math.Between(-40, 40),
        duration: Phaser.Math.Between(2500, 4500),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // Asks how many players and which colours, remembers the answer, then starts the game.
  //   'computer': you choose your own colour; the computer plays the other seats.
  //   'local':    you choose which colours play.
  //   'online':   you choose your colour, then the search for an online match starts (see OnlineScene).
  openSetup(mode) {
    if (this.setup || this.profile) return;
    const settings = settingsStore.load();
    this.setup = new SetupDialog(this, {
      mode,
      lastCount: mode === 'local' ? settings.players : settings.vsPlayers,
      lastColor: settings.humanColor,
      lastColors: settings.localColors,
      onCancel: () => {
        this.setup = null;
      },
      onStart: ({ count, colors }) => {
        this.setup = null;
        if (mode === 'online') {
          settingsStore.save({ ...settings, humanColor: colors[0] }); // remembered as your colour, like against the computer
          this.scene.start('OnlineScene', { intent: 'play', color: colors[0] });
          return;
        }
        let chosen;
        let players;
        if (mode === 'local') {
          players = localSeatsFor(colors);
          chosen = { ...settings, players: count, localColors: players };
        } else {
          players = seatsFor(count, colors[0]);
          chosen = { ...settings, vsPlayers: count, humanColor: colors[0] };
        }
        settingsStore.save(chosen);
        this.scene.start('GameScene', { mode, settings: chosen, players });
      },
    });
  }
}
