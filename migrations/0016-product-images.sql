ALTER TABLE products ADD COLUMN image_key TEXT;
ALTER TABLE products ADD COLUMN image_filename TEXT;
ALTER TABLE products ADD COLUMN image_content_type TEXT;
ALTER TABLE products ADD COLUMN image_size INTEGER;

CREATE TRIGGER products_image_shape_insert
BEFORE INSERT ON products
WHEN NOT (
  (NEW.image_key IS NULL AND NEW.image_filename IS NULL AND NEW.image_content_type IS NULL AND NEW.image_size IS NULL)
  OR (
    NEW.image_key IS NOT NULL
    AND NEW.image_filename IS NOT NULL
    AND NEW.image_content_type IS NOT NULL
    AND NEW.image_content_type IN ('image/jpeg', 'image/png', 'image/webp')
    AND NEW.image_size IS NOT NULL
    AND NEW.image_size BETWEEN 1 AND 5000000
  )
)
BEGIN
  SELECT RAISE(ABORT, 'product_image_shape_invalid');
END;

CREATE TRIGGER products_image_shape_update
BEFORE UPDATE OF image_key, image_filename, image_content_type, image_size ON products
WHEN NOT (
  (NEW.image_key IS NULL AND NEW.image_filename IS NULL AND NEW.image_content_type IS NULL AND NEW.image_size IS NULL)
  OR (
    NEW.image_key IS NOT NULL
    AND NEW.image_filename IS NOT NULL
    AND NEW.image_content_type IS NOT NULL
    AND NEW.image_content_type IN ('image/jpeg', 'image/png', 'image/webp')
    AND NEW.image_size IS NOT NULL
    AND NEW.image_size BETWEEN 1 AND 5000000
  )
)
BEGIN
  SELECT RAISE(ABORT, 'product_image_shape_invalid');
END;
