import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import type { ProductImageFixture } from './product-ui-types';

interface ProductImageEditorProps {
  image?: ProductImageFixture;
  disabled?: boolean;
  resetKey?: number;
  onChange: () => void;
  onBlockersChange?: (blockers: string[]) => void;
  onPendingImageChange?: (change: File | 'remove' | null) => void;
}

interface SelectedImage {
  file: File;
  contentType: ProductImageFixture['contentType'];
}

const MAX_PRODUCT_IMAGE_BYTES = 5_000_000;

function contentTypeFor(bytes: Uint8Array): ProductImageFixture['contentType'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 12 && [0x52, 0x49, 0x46, 0x46].every((value, index) => bytes[index] === value)
    && [0x57, 0x45, 0x42, 0x50].every((value, index) => bytes[index + 8] === value)) return 'image/webp';
  return null;
}

function extensionMatches(filename: string, contentType: ProductImageFixture['contentType']): boolean {
  const extension = filename.split('.').pop()?.toLocaleLowerCase();
  return (contentType === 'image/jpeg' && (extension === 'jpg' || extension === 'jpeg'))
    || (contentType === 'image/png' && extension === 'png')
    || (contentType === 'image/webp' && extension === 'webp');
}

export function ProductImageEditor({
  image,
  disabled = false,
  resetKey = 0,
  onChange,
  onBlockersChange,
  onPendingImageChange,
}: ProductImageEditorProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [savedImage, setSavedImage] = useState<ProductImageFixture | undefined>(image);
  const [removedCurrent, setRemovedCurrent] = useState(false);
  const [imageError, setImageError] = useState('');
  const [validating, setValidating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setSelectedImage(null);
    setSavedImage(image);
    setRemovedCurrent(false);
    setImageError('');
    setValidating(false);
    if (inputRef.current !== null) inputRef.current.value = '';
  }, [image, resetKey]);

  useEffect(() => {
    if (selectedImage === null) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedImage.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);

  useEffect(() => {
    const blockers: string[] = [];
    if (validating) blockers.push('Wait for the product image content check to finish.');
    if (imageError) blockers.push(imageError);
    onBlockersChange?.(blockers);
  }, [imageError, onBlockersChange, validating]);

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    setSelectedImage(null);
    setImageError('');
    onPendingImageChange?.(null);
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      setImageError(`${file.name} is ${(file.size / 1_000_000).toFixed(2)} MB. Product images must be 5 MB or smaller.`);
      return;
    }
    setValidating(true);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    } catch {
      setValidating(false);
      setImageError(`${file.name} could not be read. Choose the image again.`);
      return;
    }
    const contentType = contentTypeFor(bytes);
    setValidating(false);
    if (contentType === null) {
      setImageError(`${file.name} does not contain accepted JPEG, PNG, or WebP bytes.`);
      return;
    }
    if (!extensionMatches(file.name, contentType)) {
      setImageError(`${file.name} contains ${contentType} bytes but its filename extension does not match.`);
      return;
    }
    setRemovedCurrent(false);
    setSelectedImage({ file, contentType });
    onPendingImageChange?.(file);
    onChange();
  };

  const removeSelection = () => {
    setSelectedImage(null);
    setImageError('');
    if (inputRef.current !== null) inputRef.current.value = '';
    onPendingImageChange?.(null);
    onChange();
  };

  const removeCurrent = () => {
    setRemovedCurrent(true);
    setSelectedImage(null);
    setImageError('');
    if (inputRef.current !== null) inputRef.current.value = '';
    onPendingImageChange?.('remove');
    onChange();
  };

  const activePreview = selectedImage !== null ? previewUrl : removedCurrent ? null : savedImage?.url;
  return (
    <div className="field" id="product-image">
      <span className="field-label">Product image</span>
      <span id={`${inputId}-help`} className="field-help">Optional Customer-visible JPEG, PNG, or WebP image up to 5 MB.</span>
      {activePreview ? <img className="product-image-preview" src={activePreview} alt="Current Product" /> : null}
      {savedImage && !removedCurrent ? (
        <div className="file-summary">
          <strong>Current saved image</strong>
          <span>{savedImage.contentType} · {savedImage.filename}</span>
          <span className="meta-text numeric">{savedImage.sizeLabel}</span>
          <button className="text-button" type="button" disabled={disabled || validating} onClick={removeCurrent}>
            Remove image after save
          </button>
        </div>
      ) : null}
      {removedCurrent ? (
        <div className="notice notice-warning" role="status">
          <strong>Image will be removed from this Product after save.</strong>
          <button className="text-button" type="button" disabled={disabled || validating} onClick={() => {
            if (disabled || validating) return;
            setRemovedCurrent(false);
            onPendingImageChange?.(null);
            onChange();
          }}>
            Undo image removal
          </button>
        </div>
      ) : null}
      {validating ? <div className="file-summary" role="status"><strong>Checking image</strong><span>The Product cannot be saved until image bytes are confirmed.</span></div> : null}
      {selectedImage ? (
        <div className="file-summary">
          <strong>{savedImage ? 'Replacement selected' : 'Image selected'}</strong>
          <span>{selectedImage.contentType} · {selectedImage.file.name}</span>
          <span className="meta-text numeric">{(selectedImage.file.size / 1_000_000).toFixed(2)} MB</span>
          <button className="text-button" type="button" disabled={disabled || validating} onClick={removeSelection}>Remove selected image</button>
        </div>
      ) : null}
      {imageError ? (
        <div className="inline-actions">
          <button className="text-button" type="button" disabled={disabled || validating} onClick={() => {
            setImageError('');
            setSelectedImage(null);
            onPendingImageChange?.(null);
          }}>
            Clear image error
          </button>
        </div>
      ) : null}
      <div className="file-actions">
        <label className={`button file-input-label${disabled || validating ? ' disabled' : ''}`} htmlFor={inputId}>
          {savedImage || selectedImage ? 'Replace image' : 'Choose image'}
          <input
            id={inputId}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            ref={inputRef}
            disabled={disabled || validating}
            aria-invalid={Boolean(imageError)}
            aria-describedby={`${inputId}-help${imageError ? ` ${inputId}-error` : ''}`}
            onChange={(event) => void chooseImage(event)}
          />
        </label>
      </div>
      {imageError ? <span id={`${inputId}-error`} className="field-error" role="alert">{imageError}</span> : null}
    </div>
  );
}
