import graph from './graph';

export default (router) => {

  router.route('/graph').post(function (req, res) {
    graph.get(req.body.q, req.body.returnArray)
            .then(function (data) {
              res.status(200).json(data);
            }).catch(function (err) {
              res.status(500).json(err);
            });
  });

  router.route('/graph/relationships/:id').get(function (req, res) {
    graph.getRelationships(req.params.id)
            .then(function (data) {
              res.status(200).json(data);
            })
            .catch(function (err) {
              res.status(500).json(err);
            });
  });

};



