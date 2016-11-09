var _= require('lodash');
var type = require('./type');
var graph = require('./graph');
var predicate = require('./predicate');
var cypher = require('./cypher');
var image = require('./image');
var utils = require('./utils');
var changeCase = require('change-case');

//Returns picture comparisons for 2 nodes 
//(id1,id2) on 'BY'
function getVisualComparisons(id1, id2, options) { 

  var parsed1 = utils.getMatch(id1,'n');
  var parsed2 =  utils.getMatch(id2,'m');
  var q = parsed1 + ' with n ' + parsed2;
  
  q += ' with n,m match (n) <- [:BY] - (c1:Picture) - [r] - (c2:Picture) - [:BY] -> (m)';
  q += ' with c1,c2,r match (c1) - [:IMAGE] - (i1:Main:Image) ';
  q += ' with c1,c2,i1,r match (c2) - [:IMAGE] - (i2:Main:Image) ';
  q += ' return c1,ID(c1),labels(c1),i1,c2,ID(c2),labels(c2),i2,type(r)';
  
  return cypher.executeQuery(q).then(onLoaded);
  
  function onLoaded(data) {
    var out = data.map(function (val) {
      var item = {};
      var props = {
        from: utils.camelCase(val.row[4]),
        to: utils.camelCase(val.row[0])
      };
          
      if (options.format === 'compact') {
        item.from = { title: props.from.title };
        item.to = { title: props.to.title } ;
        item.predicate = predicate.get(val.row[8]).toString();
      } else {
        item.from = _.extend(props.from, {
          id: val.row[1],
          labels: val.row[2]
        });
        item.to = _.extend(props.to, {
          id: val.row[5],
          labels: val.row[6]
        });
        item.predicate = predicate.get(val.row[8]);
      }
      item.from.image = image.configure(val.row[3], options);
      item.to.image = image.configure(val.row[7], options);
      return item;
    });
    
    return out;
  }
}

//Returns picture comparisons for 1 node with other nodes
//on 'BY'
function getAllVisualComparisons(id, options) { 

  var parsed = utils.getMatch(id,'n');

  var q = parsed + ' with n ';
  
  q += ' match (n) <- [:BY] - (c1:Picture) - [r] - (c2:Picture) - [:BY] -> (m)';
  q += ' with m,c1,c2,r match (c1) - [:IMAGE] - (i1:Main:Image) ';
  q += ' with m,c1,c2,i1,r match (c2) - [:IMAGE] - (i2:Main:Image) ';
  q += ' return c1,ID(c1),labels(c1),i1,c2,ID(c2),labels(c2),i2,type(r),m';
  
  return cypher.executeQuery(q).then(onLoaded);
  
  function onLoaded(data) {
    var out = data.map(function (val) {
      var item = {};
      var props = {
        from: utils.camelCase(val.row[4]),
        to: utils.camelCase(val.row[0])
      };
          
      if (options.format === 'compact') {
        item.from = { title: props.from.title };
        item.to = { title: props.to.title } ;
        item.predicate = predicate.get(val.row[8]).toString();
      } else {
        item.from = _.extend(props.from, {
          id: val.row[1],
          labels: val.row[2]
        });
        item.to = _.extend(props.to, {
          id: val.row[5],
          labels: val.row[6]
        });
        item.predicate = predicate.get(val.row[8]);
      }
      item.from.image = image.configure(val.row[3], options);
      item.to.image = image.configure(val.row[7], options);
      item.with = utils.camelCase(val.row[9]);

      return item;
    });
    
    return out;
  }
}



//Builds a relationships object from the following data structure:
// target,ID(target),ID(rel),TYPE(rel)
//,image,ID(image)
//(image is optional)
//the predicate.toString() forms the object key
//size refers to the size of the output, can be compact or undefined
function build(rels, direction, options){
  var defaultOptions = { format: 'default' };
  options = _.extend(defaultOptions, options);
  var p, key, item, relationships = {}, itemKeys = {};
  
  for (var i = 0; i < rels.length; i++) {
            
    p = predicate.get(rels[i].row[3]);//TYPE(rel)
    if (direction) {
        p.setDirection(direction);
    }
    key = p.toString();
    if (options.format === 'verbose'){
      //return the full item
      item = utils.camelCase(rels[i].row[0]);
    } else {
      item = {
        label: rels[i].row[0].Label,
        type: rels[i].row[0].Type
      };
    }
    
    item.id = rels[i].row[1];
    //add image for picture if present
    if (rels[i].row[4]) {
      item.image= image.configure(rels[i].row[4], options);
      item.image.id = rels[i].row[5];
    }
    
    var compact = item.image ? item.image.thumb : (item.label || item.id);
    
    if (!relationships[key]) {
      if (options.format === 'compact') {
        relationships[key] = [compact];
      } else {
        relationships[key] = {
          predicate: p, 
          items: [item]
        };
      }
      itemKeys[key] = [item.id];
    } else {
      //add if not present
      if (itemKeys[key].indexOf(item.id) === -1){
        if (options.format === 'compact'){
          relationships[key].push(compact);
        }
        else {
          relationships[key].items.push(item);
        }
        itemKeys[key].push(item.id);
      }
    }
  }
  return relationships;
}

//options
//format=compact
function relationships(statements, options) {
  return cypher.executeStatements(statements).then(function(results) {
    var rels = build(results[0].data, 'out', options);
    if (results.length > 1 && results[1].data && results[1].data.length){
      _.extend(rels, build(results[1].data, 'in', options));
    }
    return rels;
  });
}

var api = {
  //saves edge to neo (update/create)
  //TODO: according to certain rules labels will need to be maintained when relationships are created. (update not required as we always delete and recreate when changing start/end nodes)
  //tag a with label b where:
  // a=person and b=provenance (eg painter from france)
  // a=person and n=group, period (eg painter part of les fauves / roccocco)
  // a=picture and b=non-person (eg picture by corot / of tree) - although typically this will be managed through labels directly (which will then in turn has to keep relationships up to date)
  save: function (edge) {//startNode and endNode provide the full node objects for the edge
    //remove any empty properties
    for (var p in edge) {
      if (edge[p] === null || edge[p] === undefined || edge[p] === '') {
          delete edge[p];
      }
    }
    if (edge.id) { //update
        api.update(edge);
    } else {//new
        api.insert(edge);
    }
  },
  update: function(edge) {
    var statements = [];
    statements.push(cypher.buildStatement('match (a)-[r]->(b) where ID(a) = ' + 
      edge.start.id + ' and ID(b)=' + edge.end.id + 
      ' and ID(r)=' + edge.id + ' delete r'));
    statements.push(cypher.buildStatement('match(a),(b) where ID(a)=' + edge.start.id + 
      ' and ID(b) = ' + edge.end.id + 
      ' create (a)-[r:' + edge.type + 
      ' {props}]->(b) return r', 'graph', { 'props': edge.properties }));

    return cypher.executeStatements(statements)
      .then(function (results) {
        return graph.build(results[0].data);
      });
  },
  insert:function(edge){
    var aIsPerson = edge.start.labels.indexOf('Person') > -1;
    var bIsProvenance = edge.end.labels.indexOf('Provenance') > -1;
    var bIsGroup = edge.end.labels.indexOf('Group') > -1;
    var bIsPeriod = edge.end.labels.indexOf('Period') > -1;
    var tagAwithB = ((aIsPerson && (bIsProvenance || bIsGroup || bIsPeriod)) &&
      edge.type !== 'INFLUENCES') || edge.type === 'TYPE_OF';
    
    var statements = [];
    
    if (tagAwithB) {
      statements.push(cypher.buildStatement('match(a) where ID(a)=' + 
        edge.start.id + ' set a:' + edge.end.Lookup));
    }
    
    statements.push(cypher.buildStatement('match(a),(b) where ID(a)=' + edge.start.id + 
      ' and ID(b) = ' + edge.end.id + 
      ' create (a)-[r:' + edge.type + 
      ' {props}]->(b) return r', 'graph', { 'props': edge.properties }));
        
    return cypher.executeStatements(statements)
      .then(function (results) {
        var out = graph.build(results[statements.length - 1].data);
        return out;
      });
  },
  delete: function (edge) {
    if (edge && edge.id) {
        var statements = [];
        //remove label that may be in place due to relationship
        statements.push(cypher.buildStatement('match (a) where ID(a) = ' + 
          edge.start.id + ' remove a:' + edge.end.label));
        statements.push(cypher.buildStatement('match (a)-[r]->(b) where ID(r)=' + 
          edge.id + ' delete r'));
        return cypher.executeStatements(statements);
    }
  },
  buildCreateStatement: function(n, predicate, e) {
    if (e.id === undefined || e.id < 0) {
      throw ('Cannot create relationship with item that has no id');
    }
    if (n.id === undefined || e.id < 0) {
      throw ('Cannot create relationship for item without id');
    }
    var relType = predicate.lookup.toUpperCase();
    var q;
    if (predicate.direction === 'out') {
        q = 'match n,m where ID(n)=' + n.id + ' and ID(m)=' + e.id;
        q += '  create (n) - [:' + relType + '] -> (m)';
    }
    else if (predicate.direction === 'in')  {
        q = 'match n,m where ID(n)=' + n.id + ' and ID(m)=' + e.id;
        q += '  create (n) <- [:' + relType + '] - (m)';
    }
    else{
        throw('Invalid predicate direction: ' + predicate.direction);
    }
    return cypher.buildStatement(q);
  },
  buildRemoveStatement: function(n, predicate, e) {
    var relType = predicate.lookup.toUpperCase();
    var q;
    if (predicate.direction === 'out') {
        q = 'match (n) - [r:' + relType + '] -> (m)';
        q += ' where ID(n)=' + n.id + ' and ID(m)=' + e.id + '  delete r';
    } else if (predicate.direction === 'in')  {
        q = 'match (n) <- [r:' + relType + '] - (m)';
        q += ' where ID(n)=' + n.id + ' and ID(m)=' + e.id + '  delete r';
    } else {
        throw('Invalid predicate direction: ' + predicate.direction);
    }
    return cypher.buildStatement(q);
  },
  //returns an array of relationship differences between the passed in node 
  //and its saved version
  //each item in the array is formed
  //{
  //  'predicate':{'lookup':'LIKES',direction:'out'}
  //  ,add:[{id:123},{id:456}],remove:[{id:789},{id:543}]}
  //}
  difference: function(n) {
    return api.list.conceptual(n)
      .then(function(existingRelationships) {
        var key, changed, newRel, existingRel, itemsToRemove, itemsToAdd, diff = [];
        for (key in n.relationships) {
          //key is the predicate.toString() which includes direction (influenced / influenced by)
          newRel = n.relationships[key];
          if (!_.isArray(newRel.items)){ 
            throw('Relationship items must be an array');
          }
          existingRel = existingRelationships ? existingRelationships[key]:null;
          if (!existingRel) {
            changed = { predicate: newRel.predicate, add: newRel.items, remove:[] };
            diff.push(changed);
          } else {
            itemsToRemove = utils.difference(existingRel.items, newRel.items);
            itemsToAdd = utils.difference(newRel.items, existingRel.items);
            if (itemsToAdd.length || itemsToRemove.length) {
              changed = { predicate: newRel.predicate, add: itemsToAdd, remove: itemsToRemove };
              diff.push(changed);
            }
          }
        }
      
        for (key in existingRelationships) {
          newRel = n.relationships ? n.relationships[key]:null;
          existingRel = existingRelationships[key];
          if (!newRel) {     //relationship not present in node so remove it from DB
            changed = { predicate: existingRel.predicate, remove: existingRel.items, add: [] };
            diff.push(changed);
          }
        }
      
        return diff;
      });
  },
  list: {
    //web links
    web: function(id) {
      var i, q = utils.getMatch(id) + '  with n match (n) - [r:LINK] - (m:Link)     return ID(m), m.Name,m.Url';
      return cypher.executeQuery(q).then(function(links) {
        var weblinks = [];
        for (i = 0; i < links.length; i++) {
            weblinks.links.push({
                name: links[i].row[1], 
                url: links[i].row[2]
            });
        }
        return weblinks;
      });
    },
    //All relationships
    //NB will return all pictures by an artist or in a category 
    //Used by picture.getwithrels
    all: function(id, options) {
      var match = utils.getMatch(id);
      var statements = [];
      //out 
      statements.push(cypher.buildStatement(match + ' with n match (n) - [r] -> (m)  return m,ID(m), ID(r),TYPE(r)', 'row'));
      //in
      statements.push(cypher.buildStatement(match + ' with n match (n) <- [r] - (m)  return n,ID(m),ID(r),TYPE(r)', 'row'));
      return relationships(statements, options);
    },
    //Relationships with 'Label' (non picture) nodes
    //Aggregated by [predicate + direction ('->' or '-<')] which form the object keys
    //options.format is compact,default
    conceptual: function (id, options) {
      var match = utils.getMatch(id);
      var statements = [];
      //out 
      statements.push(cypher.buildStatement(match + ' with n match (n) - [r] -> (m:Label)  return m,ID(m),ID(r),TYPE(r)', 'row'));
      //in
      statements.push(cypher.buildStatement(match + ' with n match (n) <- [r] - (m:Label)  where  NOT((n) <-[:BY]-(m))    return m,ID(m),ID(r),TYPE(r)', 'row'));
      return relationships(statements, options);
    },
    //Relationships between 2 nodes based on relationships between their creations
    visual: function(id1, id2, options) {
      if (id1 && id2){
        return getVisualComparisons(id1, id2, options);
      } else if (options.summary) {
          //return relationships only without creations
          var q = utils.getMatch(id1);
          q += ' with n match (n) <- [:BY] - (c1:Picture) - [] - (c2:Picture) - [:BY] -> (m)';
          q += ' return m,ID(m),-1,\'visual\'';
          return cypher.executeQuery(q).then(function(data) {
              return build(data, options);
          });
      } else {
        return getAllVisualComparisons(id1, options);
      }
    },
    allShortest: function(from, to, options) {

      from = utils.getMatch(from,'n');
      to = utils.getMatch(to,'m').replace('match','');
      var q = `${from}, ${to},
        path = allshortestpaths((n)-[*]-(m)) 
        WHERE NONE (r IN rels(path) 
          WHERE 
          type(r)= "INSTANCE_OF" or 
          type(r)="DEPICTS"  OR 
          TYPE(r)="CREATED" OR 
          TYPE(r)="BY" 
        )
        RETURN path`;
      return cypher.executeQuery(q,'graph').then(function(data) {
          var out = { nodes: {}, edges:{} };
          data.slice(0,3).forEach(function(d) {
            d.graph.nodes.forEach(function(n) {
              _.extend(n, n.properties);
              delete n.properties;
              delete n.Text;
              delete n.labels;
              out.nodes[n.id] = utils.camelCase(n);
            });
            d.graph.relationships.forEach(function(e) {
              out.edges[e.id] = e;
            });
          });
          return out;
      });
    },
    shortest: function(from, to, options) {
      //NB shortest excludes FROM
      from = utils.getMatch(from,'n');
      to = utils.getMatch(to,'m').replace('match','');
      var q = `${from}, ${to},
        path = shortestpath((n)-[*]-(m)) 
        WHERE NONE (r IN rels(path) 
          WHERE 
          type(r)= "INSTANCE_OF" or 
          type(r)="DEPICTS"  OR 
          TYPE(r)="CREATED" OR 
          TYPE(r)="BY" OR
          TYPE(r)="FROM"
        )
        RETURN path`;
      return cypher.executeQuery(q,'graph').then(function(data) {
          var out = { nodes: {}, edges:{} };
          data.forEach(function(d) {
            d.graph.nodes.forEach(function(n) {
              _.extend(n, n.properties);
              delete n.properties;
              delete n.Text;
              delete n.labels;
              out.nodes[n.id] = utils.camelCase(n);
            });
            d.graph.relationships.forEach(function(e) {
              out.edges[e.id] = e;
            });
          });
          return out;
      });
    }
  }
};

module.exports = api;
