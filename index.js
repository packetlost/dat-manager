var mkdirp = require('mkdirp')
var collect = require('collect-stream')
var extend = require('extend')
var level = require('level')
var parallel = require('run-parallel')
var debug = require('debug')('dat-manager')
var path = require('path')
var Dat = require('dat')

module.exports = Manager

function Manager (opts) {
  if (!(this instanceof Manager)) return new Manager(opts)
  if (!opts) opts = {}
  this.db = opts.db || createDb(opts)
  this.location = opts.location || path.resolve('dats')
  this.swarms = {}
  this.init(function (err) {
    if (err) throw err
  })
}

Manager.prototype.get = function (name, cb) {
  if (!name) return cb(new Error('Name required'))
  return this.db.get(name, cb)
}

Manager.prototype.rename = function (name, newName, cb) {
  var self = this
  self.db.get(name, function (err, data) {
    if (err) return cb(err)
    self.db.put(newName, data, function (err, data) {
      if (err) return cb(err)
      if (self.swarms[name]) {
        self.swarms[newName] = self.swarms[name]
        delete self.swarms[name]
      }
      self.db.del(name, data, cb)
    })
  })
}

Manager.prototype.update = function (name, data, cb) {
  var self = this
  if (!name) return cb(new Error('Name required'))
  if (data.name !== name) {
    self.rename(name, data.name, function (err) {
      if (err) return cb(err)
      self.update(data.name, data, cb)
    })
  } else {
    self.db.get(name, function (err, oldData) {
      if (err) return cb(err)
      self.db.put(name, extend(oldData, data), cb)
    })
  }
}

Manager.prototype.stop = function (name, cb) {
  var self = this
  if (!name) return cb(new Error('Name required'))
  console.log(this.swarms)
  var swarm = this.swarms[name]
  if (!swarm) return cb(new Error('No dat running with that name'))
  debug('stopping', name)
  swarm.destroy()
  this.swarms[name] = undefined
  self.db.get(name, function (err, dat) {
    if (err) return cb(err)
    dat.state = 'inactive'
    self.db.put(name, dat, function (err) {
      if (err) return cb(err)
      debug('done', dat)
      cb(null, dat)
    })
  })
}

Manager.prototype.start = function (key, opts, cb) {
  var self = this
  if (!key) return cb(new Error('Name required'))
  debug('starting', key, opts)
  self.db.get(key, function (err, dat) {
    if (err) {
      if (err.notFound) return download(opts.link)
      else return cb(err)
    }
    if (!opts.link) return download(dat.link)
    return download(opts.link)
  })

  function download (link) {
    var db = Dat()
    var location = path.join(self.location, link.replace('dat://', ''))
    debug('downloading', link, 'to', location)
    db.download(link, location, function (err, swarm) {
      if (err) return cb(err)
      debug('done downloading')
      var dat = {
        state: 'active',
        link: link,
        date: Date.now(),
        location: location
      }
      self.swarms[key] = swarm
      self.db.put(key, dat, function (err) {
        if (err) return cb(err)
        return cb(null, dat)
      })
    })
  }
}

Manager.prototype.delete = function (name, cb) {
  var self = this
  self.db.del(name, function (err) {
    if (err) return cb(err)
    var swarm = self.swarms[name]
    swarm.destroy()
    self.swarms[name] = undefined
    cb()
  })
}

Manager.prototype.list = function (cb) {
  collect(this.db.createReadStream(), cb)
}

Manager.prototype.close = function (cb) {
  var self = this
  var stream = self.db.createKeyStream()
  var funcs = []
  stream.on('data', function (name) {
    funcs.push(function (done) {
      self.stop(name, done)
    })
  })
  stream.on('end', function () {
    parallel(funcs, function (err) {
      if (err) return cb(err)
      self.db.close()
      return cb()
    })
  })
}

Manager.prototype.init = function (cb) {
  var self = this
  var stream = self.db.createReadStream()
  var funcs = []

  stream.on('data', function (dat) {
    funcs.push(function (done) {
      if (dat.value.state === 'active') self.start(dat.key, {link: dat.value.link}, done)
      else done()
    })
  })

  stream.on('end', function () {
    parallel(funcs, function (err) {
      if (err) return cb(err)
      return cb()
    })
  })
}

function createDb (opts) {
  opts.DB_PATH = opts.DB_PATH || './data'
  mkdirp.sync(opts.DB_PATH)
  return level(opts.DB_PATH, { valueEncoding: 'json' })
}
