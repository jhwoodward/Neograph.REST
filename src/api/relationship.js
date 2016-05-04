import _ from 'lodash';
import utils from './utils';
import cypher from './cypher';
import predicate from './predicate';
import image from './image';
import graph from './graph';

 // Returns picture comparisons for 2 nodes
 // (id1,id2) on 'BY'
const getVisualComparisons = (id1, id2, options) => {
  const parsed1 = utils.getMatch(id1, 'n');
  const parsed2 = utils.getMatch(id2, 'm');
  const q = `
          ${parsed1} with n ${parsed2}
          with n,m match (n) <- [:BY] - (c1:Picture) - [r] - (c2:Picture) - [:BY] -> (m)
          with c1,c2,r match c1 - [:IMAGE] - (i1:Main:Image) 
          with c1,c2,i1,r match c2 - [:IMAGE] - (i2:Main:Image) 
          return c1,ID(c1),labels(c1),i1,c2,ID(c2),labels(c2),i2,type(r) limit 50
        `;
  return cypher.executeQuery(q).then((data) => {
    const out = data.map((val) => {
      const item = {};
      const props = {
        from: utils.camelCase(val.row[4]),
        to: utils.camelCase(val.row[0])
      };
      if (options.format === 'compact') {
        item.from = { title: props.from.title };
        item.to = { title: props.to.title };
        item.predicate = predicate.get(val.row[8]).toString();
      } else {
        item.from = Object.assign(props.from, {
          id: val.row[1],
          labels: val.row[2]
        });
        item.to = Object.assign(props.to, {
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
  });
};

    // Builds a relationships object from the following data structure:
    // target,ID(target),ID(rel),TYPE(rel)
    // ,image,ID(image)
    // (image is optional)
    // the predicate.toString() forms the object key
    // size refers to the size of the output, can be compact or undefined
const build = (rels, direction, opt) => {
  const defaultOptions = { format: 'default' };
  const options = Object.assign({}, defaultOptions, opt);
  const relationships = {};
  const itemKeys = {};
  for (let i = 0; i < rels.length; i ++) {
    const p = predicate.get(rels[i].row[3]);
    if (direction) {
      p.setDirection(direction);
    }
    const key = p.toString();
    let item;
    if (options.format === 'verbose') {
      // Return the full item
      item = utils.camelCase(rels[i].row[0]);
    } else {
      item = {
        label: rels[i].row[0].Label,
        type: rels[i].row[0].Type
      };
    }
    item.id = rels[i].row[1];
    // Add image for picture if present
    if (rels[i].row[4]) {
      item.image = image.configure(rels[i].row[4], options);
      item.image.id = rels[i].row[5];
    }
    const compact = item.image ? item.image.thumb : (item.label || item.id);
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
      // Add if not present
      if (itemKeys[key].indexOf(item.id) === -1) {
        if (options.format === 'compact') {
          relationships[key].push(compact);
        } else {
          relationships[key].items.push(item);
        }
        itemKeys[key].push(item.id);
      }
    }
  }
  // Convert to array
  const arr = [];
  Object.keys(relationships).forEach(key => {
    const r = relationships[key];
    r.key = key;
    arr.push(r);
  });
  return arr;
};

// options format=compact
const relationships = (statements, options) => cypher.executeStatements(statements).
then((results) => {
  let inbound;
  const outbound = build(results[0].data, 'out', options);
  if (results.length > 1 && results[1].data && results[1].data.length) {
    inbound = build(results[1].data, 'in', options);
  }
  return Object.assign(outbound, inbound);
});


const api = {
    // Saves edge to neo (update/create)
    // TODO: according to certain rules labels will need to be maintained
    // when relationships are created.
    // (update not required as we always delete and recreate when changing start/end nodes)
    // tag a with label b where:
    //   a=person and b=provenance (eg painter from france)
    //   a=person and n=group, period (eg painter part of les fauves / roccocco)
    //   a=picture and b=non-person (eg picture by corot / of tree) - although typically
    //   this will be managed through labels directly
    //   (which will then in turn has to keep relationships up to date)
  save: edge => {
    // startNode and endNode provide the full node objects for the edge
    // Remove any empty properties
    Object.keys(edge).forEach(key => {
      if (edge[key] === null || edge[key] === undefined || edge[key] === '') {
        delete edge[key];
      }
    });
    if (edge.id) {
      api.update(edge);
    } else {
      api.insert(edge);
    }
  },
  update: edge => {
    const statements = [];
    statements.push(cypher.
          buildStatement(`match (a)-[r]->(b) where ID(a) = ${edge.start.id} 
            and ID(b)=${edge.end.id} and ID(r)=${edge.id} 
            delete r`));
    statements.push(cypher.
          buildStatement(`
            match(a),(b) where ID(a)=${edge.start.id} and ID(b) = ${edge.end.id} 
            create (a)-[r:${edge.type} {props}]->(b) return r`
          , 'graph'
          , { props: edge.properties }));

    return cypher.executeStatements(statements).
          then((results) => graph.build(results[0].data));
  },
  insert: edge => {
    const aIsPerson = edge.start.labels.indexOf('Person') > -1;
    const bIsProvenance = edge.end.labels.indexOf('Provenance') > -1;
    const bIsGroup = edge.end.labels.indexOf('Group') > -1;
    const bIsPeriod = edge.end.labels.indexOf('Period') > -1;
    const tagAwithB = ((aIsPerson && (bIsProvenance || bIsGroup || bIsPeriod)) &&
    edge.type !== 'INFLUENCES') || edge.type === 'TYPE_OF';
    const statements = [];
    if (tagAwithB) {
      statements.push(cypher.buildStatement(`
          match(a) where ID(a)=${edge.start.id} 
          set a:${edge.end.Lookup}
          `));
    }

    statements.push(cypher.buildStatement(`
          match(a),(b) where ID(a)=${edge.start.id} and ID(b)=${edge.end.id} 
          create (a)-[r:${edge.type} {props}]->(b) 
          return r`
          , 'graph'
          , { props: edge.properties }));

    return cypher.executeStatements(statements).
          then(results => graph.build(results[statements.length - 1].data));
  },
  delete: edge => {
    const statements = [];
    // remove label api may be in place due to relationship
    statements.push(cypher.buildStatement(`
    match (a) where ID(a) = ${edge.start.id} 
    remove a:${edge.end.label}
    `));
    statements.push(cypher.buildStatement(`
    match (a)-[r]->(b) where ID(r)=${edge.id} 
    delete r`));
    return cypher.executeStatements(statements);
  },
  createStatement: (n, p, e) => {
    if (e.id === undefined || e.id < 0) {
      throw ('Cannot create relationship with item api has no id');
    }
    if (n.id === undefined || e.id < 0) {
      throw ('Cannot create relationship for item without id');
    }
    const relType = p.lookup.toUpperCase();
    let q;
    if (p.direction === 'out') {
      q = `
              match n,m where ID(n)=${n.id} and ID(m)=${e.id}
              create (n) - [:${relType}] -> (m)
              `;
    } else if (p.direction === 'in') {
      q = `
              match n,m where ID(n)=${n.id} and ID(m)=${e.id}
              create (n) <- [:${relType}] - (m)
              `;
    } else {
      throw (`Invalid predicate direction: ${p.direction}`);
    }
    return cypher.buildStatement(q);
  },
  removeStatement: (n, p, e) => {
    const relType = p.lookup.toUpperCase();
    let q;
    if (p.direction === 'out') {
      q = `
              match (n) - [r:${relType}] -> (m)
              where ID(n)=${n.id} and ID(m)=${e.id}  
              delete r
              `;
    } else if (p.direction === 'in') {
      q = `
              match (n) <- [r:${relType}] - (m)
              where ID(n)=${n.id} and ID(m)=${e.id} 
              delete r
              `;
    } else {
      throw (`Invalid predicate direction: ${p.direction}`);
    }
    return cypher.buildStatement(q);
  },
  // Returns an array of relationship differences between the passed in node
  // and its saved version
  // each item in the array is formed
  // {
  //   'predicate':{'lookup':'LIKES',direction:'out'}
  //   ,add:[{id:123},{id:456}],remove:[{id:789},{id:543}]}
  // }
  difference: n => api.list.conceptual(n).
    then(existingRelationships => {
      const diff = [];
      Object.keys(n.relationships).forEach(key => {
        // Key is the predicate.toString() which includes direction (influenced / influenced by)
        const newRel = n.relationships[key];
        if (!_.isArray(newRel.items)) {
          throw ('Relationship items must be an array');
        }
        const existingRel = existingRelationships ? existingRelationships[key] : null;
        if (!existingRel) {
          const changed = { predicate: newRel.predicate, add: newRel.items, remove: [] };
          diff.push(changed);
        } else {
          const itemsToRemove = utils.difference(existingRel.items, newRel.items);
          const itemsToAdd = utils.difference(newRel.items, existingRel.items);
          if (itemsToAdd.length || itemsToRemove.length) {
            const changed = { predicate: newRel.predicate, add: itemsToAdd, remove: itemsToRemove };
            diff.push(changed);
          }
        }
      });
      Object.keys(existingRelationships).forEach(key => {
        const newRel = n.relationships ? n.relationships[key] : null;
        const existingRel = existingRelationships[key];
        if (!newRel) {
          // Relationship not present in node so remove it from DB
          const changed = { predicate: existingRel.predicate, remove: existingRel.items, add: [] };
          diff.push(changed);
        }
      });
      return diff;
    }),
  list: {
        // web links
    web: (id) => {
      const q = `
      ${utils.getMatch(id)} with n match (n) - [r:LINK] - (m:Link) 
      return ID(m), m.Name,m.Url
      `;
      return cypher.executeQuery(q).then(links => {
        const weblinks = [];
        for (let i = 0; i < links.length; i++) {
          weblinks.links.push({
            name: links[i].row[1],
            url: links[i].row[2]
          });
        }
        return weblinks;
      });
    },
    // All relationships
    // NB will return all pictures by an artist or in a category
    // Used by picture.getwithrels
    all: (id, options) => {
      const match = utils.getMatch(id);
      const statements = [];
      // out
      statements.push(cypher.buildStatement(`
      ${match} with n match (n) - [r] -> (m)  
      return m,ID(m), ID(r),TYPE(r)`
      , 'row'));
      // in
      statements.push(cypher.buildStatement(`
      ${match} with n match (n) <- [r] - (m)  
      return n,ID(m),ID(r),TYPE(r)`
      , 'row'));
      return relationships(statements, options);
    },
    // Relationships with 'Label' (non picture) nodes
    // Aggregated by [predicate + direction ('->' or '-<')] which form the object keys
    // options.format is compact,default
    conceptual: (id, options) => {
      const match = utils.getMatch(id);
      const statements = [];
      // out
      statements.push(cypher.buildStatement(`
        ${match} with n match (n) - [r] -> (m:Label)  return m,ID(m),ID(r),TYPE(r)`
        , 'row'));
      // in
      statements.push(cypher.buildStatement(`
        ${match} with n match (n) <- [r] - (m:Label)  where  NOT(n <-[:BY]-(m)) 
        return m,ID(m),ID(r),TYPE(r)`
        , 'row'));
      return relationships(statements, options);
    },
    // Relationships with 'Property'  nodes
    // format is default
    property: (id) => {
      const match = utils.getMatch(id);
      const statements = [];
      // out only
      statements.push(cypher.buildStatement(`
        ${match} with n match (n) - [r:PROPERTY] -> (m:Property)  
        return m,ID(m),ID(r),TYPE(r)`
        , 'row'));
      return relationships(statements, { format: 'verbose' });
    },
    // Relationships with 'Picture' nodes
    // Can be used
    // -- to get pictures related to an conceptual entity (eg paintings by an artist)
    // -- to get pictures related to a picture
    // -- if 2 ids are passed
    // ------picture comparisons between the 2 nodes are returned
    visual: (id1, id2, options) => {
      if (id1 && id2) {
        return getVisualComparisons(id1, id2, options);
      }
      const match = utils.getMatch(id1);
      const statements = [];
      // out
      statements.push(cypher.buildStatement(`
        ${match} with n match (n) - [r] -> (m:Picture) - [:IMAGE] -> (i:Image:Main)
        return m,ID(m),ID(r),TYPE(r),i,ID(i),LABELS(i)`
        , 'row'));
      // in
      statements.push(cypher.buildStatement(`
        ${match} with n match (n) <- [r] - (m:Picture)- [:IMAGE] -> (i:Image:Main)
        return m,ID(m), ID(r),TYPE(r),i,ID(i),LABELS(i)`
        , 'row'));
      return relationships(statements, options);
    },
    // Relationships with creators
    // inferred from relationships between their creations
    // they may or may not have an explicit relationship defined
    inferred: (id, options) => {
      const q = `${utils.getMatch(id)} 
        with n match (n) <- [:BY] - (c1:Picture) - [] - (c2:Picture) - [:BY] -> (m)
        return m,ID(m),-1,'inferred',m.Label
      `;
      return cypher.executeQuery(q).then(data => build(data, options));
    }
  }
};

export default api;
