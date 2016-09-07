var cypher = require('./cypher');
var node = require('./node');

var api = {
  //n.id = node id
  //n.wikipagename (nb was just name)
  saveWikipagename: function (n) {
      if (!n.wikipagename){
          throw 'wikipagename not supplied';
      }
      if (!n.id){
          throw 'no id supplied';
      }
      
      var statements = [];
      statements.push(cypher.buildStatement('match(n) where ID(n)=' + n.id + '  set n.Wikipagename={page} return n', 'row', { 'page': n.wikipagename }));
      return cypher.executeStatements(statements)
          .then(function (results) {
              return results[0].data[0].row[0];
          });
  },
  //for saving metadata from a scrape
  saveMetadata: function (d) {
    //        d = {
    //            imageUrl: imgurl,
    //            title: clean(metadatabits[0].replace('<b>', '').replace('</b>', '')),
    //            date: clean(metadatabits[1]),
    //            type: clean(metadatabits[2].split(',')[0]),
    //            dimensions: clean(metadatabits[2].split(',')[1]),
    //            collection: clean(metadatabits[3]),
    //            text: $($tr.find('td')[1]).text().replace(/\r?\n|\r/, ''),//get rid of first linebreak only
    //            page: itempageurl
    //        }
    //        or
    //      d = {
    //        imageUrl: imgurl,
    //        text: $($tr.find('td')[1]).text().replace(/\r?\n|\r/, ''),//get rid of first linebreak only
    //page: itempageurl
    //      }
    var s, statements = [];
    
    //NB POOR ASSUMPTION !
    var q = d.imageUrl ? 'match(n:Wga {ImageUrl:{imageUrl}}) ' : 'match(n:Olga {ImageCache:{imageCache}}) ';
    
    if (d.page) {
      q += ' set  n.ImageRef={page}';
      if (d.title) {
          q += ',n.Title={title}';
      }
      if (d.date) {
          q += ',n.Date={date}';
      }
      if (d.type) {
          q += ',n.Medium={type}';
      }
      if (d.dimensions) {
          q += ',n.Dimensions={dimensions}';
      }
      if (d.collection) {
          q += ',n.Collection={collection}';
      }
      if (d.metadata) {
          q += ',n.Metadata={metadata}';
      }
      q += '  return n.ImageRef';
      s = cypher.buildStatement(q, 'row', d);
      statements.push(s);
    } else {
        q += ' set  n:NoRef';
    }
    
    s = cypher.buildStatement(q, 'row', d);
    statements.push(s);
    
    return cypher.executeStatements(statements);
  },
  saveProps: function (n) {//short version for freebase prop saving
    var statements = [];
    var props = node.trimForSave(n);
    statements.push(cypher.buildStatement('match(n) where ID(n)=' + n.id + '  set n= {props} return ID(n)', 'row', { 'props': props }));
    return cypher.executeStatements(statements)
      .then(function (results) {
        return results[0].data[0].row[0];
    });
  }
};
module.exports = api;
