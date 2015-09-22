#! /usr/bin/env babel-node --experimental
import app from '../aws_metadata';
var port = process.env.PORT || 60044;
app.listen(port);
console.log('listening on %s', port)
