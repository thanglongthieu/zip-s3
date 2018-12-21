// AWS
const AWS = require('aws-sdk')
AWS.config.httpOptions = {timeout: 5000}
const S3 = new AWS.S3()

// ARCHIVE
const pump = require('pump')
const archiver = require('archiver')
const s3Stream = require('s3-upload-stream')( S3 )
const async = require('async')
module.exports.zip = ( event , callback ) => {
	var zipFile =() =>{
		return new Promise( ( resolve, reject ) => {
			const region = event.region
			const bucket = event.bucket
			const files = event.files
			if( event.config == null ) event.config = {}
			const maxCurrentPath = event.config.concurrentParts || 5 
			const maxPartSize = event.config.maxPartSize || 5195380 // 5 MB
			var fileName = event.zip.name || event.zip.key.split('/').reverse()[0]

			// ----------- UPLOAD ------------------ //
			var upload = s3Stream.upload({
				Bucket: event.zip.bucket || bucket
				,Key: event.zip.key
			})
			upload.maxPartSize( maxPartSize )
			upload.concurrentParts( maxCurrentPath )
			//upload.on('error', error => { context( error ) })
			if( event.debugMode ) upload.on('part', details => { console.log(details) })
			upload.on('uploaded', details => {
				if ( fileName ){
					var params =  {
						Bucket: bucket,
						Key: details.Key,
						Expires: 600,
						ResponseContentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent( fileName ) ,
					}
					S3.getSignedUrl('getObject', params , function (err, url) {
						if( err ) return context( err )
						details.signUrl = url
						resolve( details ) 
					})
				} else {
					context( null , details ) 
				}
			})
			
			// ----------- ARCHIVE ----------------- //
			const archive = archiver('zip', { store: true }).on('error', err => { reject(err) })
			archive.setMaxListeners(0)
			pump( archive, upload , err => {
			  if (err) {
				reject(err)
			  }
			})
			
			// ----------- RUN ZIP ----------------- //	
			async.eachSeries( files, (file, cb) => {
				var once = false
				var path = file.Path
				if( path.indexOf('/') == 0 ) path.replace('/','')
				if( !file.Id ){
					if( once == false ) archive.append( '', { name: path }), once = true, cb()
					return ;
				}
				const params = { Bucket : bucket, Key: file.Key }
				S3.headObject( params, (err, data) => {
					if (err) return cb(err)
					archive.append(S3.getObject( params ).createReadStream(), { name: path })
					.on('progress', (details) => {
					if (details.entries.total === details.entries.processed && once === false) {
						once = true
						cb()
					}
				})
			  })
			}, (err) => {
				if (err) {
					reject(err)
				}
				archive.finalize()
			})
		})
	}
	zipFile().then(
		(data) => { callback( null, data ) },
		(err) => { callback( err, null ) }
	)
}