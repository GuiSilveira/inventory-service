module.exports = {
    apps: [
        {
            name: 'inventory-service',
            script: './dist/server.js',
            watch: false,
            interpreter: 'node',
            interpreter_args: '--env-file=.env',
        },
    ],
}
