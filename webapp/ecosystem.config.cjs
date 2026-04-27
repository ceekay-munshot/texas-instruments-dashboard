module.exports = {
  apps: [{
    name: 'ti-dashboard',
    script: 'npx',
    args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000',
    cwd: '/home/user/webapp',
    watch: false,
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'development' }
  }]
}
