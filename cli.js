#!/usr/bin/env node
var args = require('minimist')(process.argv.slice(2))
var server = require('./app/server.js')

var port = 8080 || process.env.PORT

server.listen(port, function () {
  console.log('http://localhost:' + port)
})
