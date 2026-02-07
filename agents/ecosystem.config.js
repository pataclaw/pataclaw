// PM2 ecosystem file for 4 free agent players
module.exports = {
  apps: [
    {
      name: 'pataclaw-agent-0',
      script: 'free-player.js',
      cwd: __dirname,
      env: { AGENT_INDEX: '0' },
      max_restarts: 50,
      restart_delay: 60000,
      autorestart: true,
    },
    {
      name: 'pataclaw-agent-1',
      script: 'free-player.js',
      cwd: __dirname,
      env: { AGENT_INDEX: '1' },
      max_restarts: 50,
      restart_delay: 60000,
      autorestart: true,
    },
    {
      name: 'pataclaw-agent-2',
      script: 'free-player.js',
      cwd: __dirname,
      env: { AGENT_INDEX: '2' },
      max_restarts: 50,
      restart_delay: 60000,
      autorestart: true,
    },
    {
      name: 'pataclaw-agent-3',
      script: 'free-player.js',
      cwd: __dirname,
      env: { AGENT_INDEX: '3' },
      max_restarts: 50,
      restart_delay: 60000,
      autorestart: true,
    },
  ],
};
