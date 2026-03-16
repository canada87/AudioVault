module.exports = {
  apps: [
    {
      name: 'audiovault-backend',
      script: './backend/dist/index.js',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
    },
  ],
};
