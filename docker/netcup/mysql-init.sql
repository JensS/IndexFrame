-- Match the hosting server's latin1 default, while explicitly fixing this one database.
ALTER DATABASE indexframe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE indexframe_testing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON indexframe_testing.* TO 'indexframe'@'%';
