const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure destination directory exists
const uploadDir = path.join(__dirname, '../uploads/internal_chat');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'chat_' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();

  const isImage = mime.startsWith('image/') || ext.match(/\.(jpg|jpeg|png|webp|gif)$/i);
  const isVideo = mime.startsWith('video/') || ext.match(/\.(mp4|mov|3gp|mkv)$/i);
  const isDoc =
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    ext.match(/\.(pdf|doc|docx)$/i);

  if (isImage || isVideo || isDoc) {
    cb(null, true);
  } else {
    cb(new Error('Only image, video, PDF, or Word document files are allowed!'), false);
  }
};

const uploadInternalChatImages = multer({
  storage,
  fileFilter,
  limits: {
    files: 5, // Max 5 media files
    fileSize: 50 * 1024 * 1024 // 50MB max
  }
});

module.exports = {
  uploadInternalChatImages
};
