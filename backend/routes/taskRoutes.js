const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/', authMiddleware, taskController.getTasks);
router.post('/', authMiddleware, taskController.createTask);
router.patch('/:id/toggle', authMiddleware, taskController.toggleTask);
router.delete('/:id', authMiddleware, taskController.deleteTask);

module.exports = router;
