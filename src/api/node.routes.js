var node = require('./node');
  
module.exports = function(router) {

  router.route('/node/get/:id').get(function(req, res) {
    node.get(req.params.id)
      .then(function (data) {
        if (!data){
            res.sendStatus(204);
        } else {
            res.status(200).json(data);
        }
      })
      .catch(function (err) {
          res.status(500).json(err);
      });
  });
  
  router.route('/node/getWithRels/:id').get(function(req, res) {
    node.getWithRels(req.params.id)
      .then(function (data) {
        //return 204 if null 
        if (!data) {
            res.sendStatus(204);
        } else {
            res.status(200).json(data);
        }
      })
      .catch(function (err) {
        res.status(500).json(err);
      });
  });

 

  router.route('/node/save').post(function(req, res) {
    node.save(req.body.node, req.body.user)
      .then(function (data) {
        res.status(201).json(data);
      })
      .catch(function (err) {
        res.status(500).json(err);
      });
  });

  router.route('/node/saveImage').post(function(req, res) {
    node.saveImage(req.body.node)
      .then(function (data) {
        res.status(201).json(data);
      })
      .catch(function (err) {
        res.status(500).json(err);
      });
  });

  router.route('/node/delete').post(function(req, res) {
    node.delete(req.body.node)
      .then(function (data) {
          res.status(200).json(data);
      })
      .catch(function (err) {
        res.status(500).json(err);
      });
  });
  
  router.route('/node/destroy').post(function(req, res) {
    node.destroy(req.body.node)
      .then(function (data) {
        res.status(200).json(data);
      })
      .catch(function (err) {
        res.status(500).json(err);
      });
  });
  
  router.route('/node/restore').post(function(req, res) {
    node.restore(req.body.node)
      .then(function (data) {
        res.status(200).json(data);
      })
      .catch(function (err) {
        res.status(500).json(err);
      });
  });

  router.route('/node/list/labelled/:id').get(function (req, res) {
    node.list.labelled(req.params.id)
      .then(function(data) {
         res.status(200).json(data);
        })
      .catch(function (err) {
         res.status(500).json({error:err});
      });
  });

  return router;
};
