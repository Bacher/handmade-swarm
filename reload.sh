kill -SIGUSR2 `ps aux | grep -vF 'grep' | grep -F node | grep -F 'admin/index.js' | awk '{print $2}'`
