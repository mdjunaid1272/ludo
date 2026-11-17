/* global module, __dirname */
// pm2 process file for the Ludo game server:   pm2 start deploy/ecosystem.config.cjs && pm2 save
// Restart after an update:                      pm2 restart ludo
// Logs:                                         pm2 logs ludo
module.exports = {
  apps: [
    {
      name: 'ludo',
      script: 'server/start.js',
      cwd: __dirname + '/..',
      env: {
        PORT: 8080,
        HOST: '127.0.0.1', // reachable only through the reverse proxy
        STATIC_DIR: 'dist',
        TRUST_PROXY: '1', // behind nginx / Cloudflare: count each person's own address, not the proxy's
        // ALLOWED_ORIGINS: 'https://gametest2.atmegame.com', // uncomment to accept WebSockets only from your own page
        // MAX_CONNECTIONS_PER_IP: 20,
      },
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
