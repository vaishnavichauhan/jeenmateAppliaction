const { Task } = require('../models');

// GET /api/tasks
async function getTasks(req, res, next) {
  try {
    const { status, customerId, search } = req.query;

    const tasks = await Task.findAll({ status, customerId, search });
    const counts = await Task.getCounts();

    return res.status(200).json({
      success: true,
      counts,
      data: tasks
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/tasks
async function createTask(req, res, next) {
  try {
    const {
      customerId,
      customerName,
      customerPhone,
      originalMessage,
      staffNote,
      dueDate
    } = req.body;

    if (!customerName || !customerPhone) {
      return res.status(400).json({
        success: false,
        message: 'Customer name and customer phone are required.'
      });
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    const createdTask = await Task.create({
      id: taskId,
      customerId: customerId || null,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      originalMessage: originalMessage || '',
      staffNote: staffNote || '',
      dueDate: dueDate || new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0]
    });

    return res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: createdTask
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/tasks/:id/toggle
async function toggleTask(req, res, next) {
  try {
    const { id } = req.params;

    const updatedTask = await Task.toggle(id);
    if (!updatedTask) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: `Task marked as ${updatedTask.status}`,
      data: updatedTask
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/tasks/:id
async function deleteTask(req, res, next) {
  try {
    const { id } = req.params;

    const deleted = await Task.delete(id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
      id
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTasks,
  createTask,
  toggleTask,
  deleteTask
};
