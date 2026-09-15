import { useEffect, useId, useState, type ChangeEvent } from 'react';
import type { DeliveryFixture } from './product-ui-types';

interface DeliveryEditorProps {
  delivery: DeliveryFixture;
  errors?: Partial<Record<'accessTitle' | 'accessInstructions' | 'file', string>>;
  disabled?: boolean;
  resetKey?: number;
  idPrefix?: string;
  onChange: (field: 'accessTitle' | 'accessInstructions', value: string) => void;
  onBlur: (field: 'accessTitle' | 'accessInstructions') => void;
  onFileChange: () => void;
  onBlockersChange?: (blockers: string[]) => void;
  onFileMetadataChange?: (file: DeliveryFixture['file'] | undefined) => void;
  onPendingFileChange?: (change: File | 'remove' | null) => void;
}

interface SelectedFileState {
  file: File;
  kind: 'PDF' | 'ZIP';
}

const MAX_PRIVATE_FILE_BYTES = 25_000_000;

function detectedFileKind(bytes: Uint8Array): 'PDF' | 'ZIP' | null {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  const isZip = bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
  if (isPdf) return 'PDF';
  if (isZip) return 'ZIP';
  return null;
}

export function DeliveryEditor({
  delivery,
  errors = {},
  disabled = false,
  resetKey = 0,
  idPrefix = 'delivery',
  onChange,
  onBlur,
  onFileChange,
  onBlockersChange,
  onFileMetadataChange,
  onPendingFileChange,
}: DeliveryEditorProps) {
  const inputId = useId();
  const accessTitleId = `${idPrefix}-access-title`;
  const accessInstructionsId = `${idPrefix}-access-instructions`;
  const [selectedFile, setSelectedFile] = useState<SelectedFileState | null>(null);
  const [savedFile, setSavedFile] = useState<DeliveryFixture['file']>(delivery.file);
  const [removedCurrent, setRemovedCurrent] = useState(false);
  const [fileError, setFileError] = useState('');
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    setSelectedFile(null);
    setRemovedCurrent(false);
    setFileError('');
    setSavedFile(delivery.file);
    setValidating(false);
  }, [resetKey]);

  useEffect(() => {
    const blockers: string[] = [];
    if (validating) blockers.push('Wait for the private file content check to finish.');
    if (fileError || errors.file) blockers.push(fileError || errors.file || 'Choose a valid private file.');
    onBlockersChange?.(blockers);
  }, [errors.file, fileError, onBlockersChange, validating]);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    onFileChange();
    setSelectedFile(null);
    setRemovedCurrent(false);
    setFileError('');

    if (file.size > MAX_PRIVATE_FILE_BYTES) {
      setFileError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Private files must be 25 MB or smaller.`);
      return;
    }

    setValidating(true);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    } catch {
      setValidating(false);
      setFileError(`${file.name} could not be read. Choose the file again.`);
      return;
    }

    const kind = detectedFileKind(bytes);
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    const extensionKind = extension === 'pdf' ? 'PDF' : extension === 'zip' ? 'ZIP' : null;
    setValidating(false);

    if (!kind) {
      setFileError(`${file.name} does not contain accepted PDF or ZIP bytes. Choose a valid PDF or ZIP file.`);
      return;
    }
    if (extensionKind !== kind) {
      setFileError(`${file.name} contains ${kind} bytes but its filename does not match. Rename or export the file with the correct extension.`);
      return;
    }

    setSelectedFile({ file, kind });
    onFileMetadataChange?.({ name: file.name, sizeLabel: `${(file.size / 1024 / 1024).toFixed(2)} MB`, kind });
    onPendingFileChange?.(file);
  };

  const removeSelection = () => {
    setSelectedFile(null);
    setFileError('');
    onFileMetadataChange?.(savedFile);
    onPendingFileChange?.(null);
    onFileChange();
  };

  const removeCurrent = () => {
    setRemovedCurrent(true);
    setSelectedFile(null);
    setFileError('');
    onFileMetadataChange?.(undefined);
    onPendingFileChange?.('remove');
    onFileChange();
  };

  return (
    <div className="editor-fields">
      <div className="field">
        <label htmlFor={accessTitleId}>Private access title <span className="required-mark" aria-hidden="true">*</span></label>
        <input
          id={accessTitleId}
          value={delivery.accessTitle}
          disabled={disabled}
          required
          aria-invalid={Boolean(errors.accessTitle)}
          aria-describedby={errors.accessTitle ? `${accessTitleId}-error` : undefined}
          onChange={(event) => onChange('accessTitle', event.target.value)}
          onBlur={() => onBlur('accessTitle')}
        />
        {errors.accessTitle ? <span id={`${accessTitleId}-error`} className="field-error">{errors.accessTitle}</span> : null}
      </div>

      <div className="field">
        <label htmlFor={accessInstructionsId}>Private access instructions <span className="required-mark" aria-hidden="true">*</span></label>
        <textarea
          className="delivery-instructions"
          id={accessInstructionsId}
          value={delivery.accessInstructions}
          disabled={disabled}
          required
          aria-invalid={Boolean(errors.accessInstructions)}
          aria-describedby={errors.accessInstructions ? `${accessInstructionsId}-error` : undefined}
          onChange={(event) => onChange('accessInstructions', event.target.value)}
          onBlur={() => onBlur('accessInstructions')}
        />
        {errors.accessInstructions ? <span id={`${accessInstructionsId}-error`} className="field-error">{errors.accessInstructions}</span> : null}
      </div>

      <div className="field delivery-file" id="delivery-private-file">
        <span className="field-label">Optional private file</span>
        <span id={`${inputId}-help`} className="field-help">PDF or ZIP, up to 25 MB. File bytes are verified.</span>

        {removedCurrent ? (
          <div className="notice notice-warning" role="status">
            <strong>File will be removed from this Product after save.</strong>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setRemovedCurrent(false);
                onFileMetadataChange?.(savedFile);
                onPendingFileChange?.(null);
                onFileChange();
              }}
            >
              Undo file removal
            </button>
          </div>
        ) : null}

        {validating ? (
          <div className="file-summary" role="status" aria-live="polite">
            <strong>Checking file</strong>
            <span>The Product cannot be saved until PDF or ZIP bytes are confirmed.</span>
          </div>
        ) : null}

        {selectedFile ? (
          <div className="file-summary">
            <strong>{savedFile ? 'Replacement selected' : 'File selected'}</strong>
            <span>{selectedFile.kind} · {selectedFile.file.name}</span>
            <span className="meta-text numeric">{(selectedFile.file.size / 1024 / 1024).toFixed(2)} MB</span>
            {savedFile ? <p>The replacement will be used after Product save. The current saved file remains until then.</p> : null}
            <button className="text-button" type="button" disabled={disabled || validating} onClick={removeSelection}>
              Remove selected file
            </button>
          </div>
        ) : null}

        <div className="delivery-file-row">
          <span className="delivery-file-state">
            {removedCurrent
              ? 'No private file saved'
              : savedFile
                ? `${savedFile.kind} · ${savedFile.name} · ${savedFile.sizeLabel}`
                : 'No private file saved'}
          </span>
          <div className="editor-spacer" />
          {savedFile && !removedCurrent ? (
            <button className="text-button" type="button" disabled={disabled || validating} onClick={removeCurrent}>
              Remove current file after save
            </button>
          ) : null}
          <label className={`button file-input-label${disabled || validating ? ' disabled' : ''}`} htmlFor={inputId}>
            {savedFile || selectedFile ? 'Replace file' : 'Choose PDF or ZIP'}
            <input
              id={inputId}
              type="file"
              accept=".pdf,.zip,application/pdf,application/zip"
              disabled={disabled || validating}
              aria-invalid={Boolean(fileError || errors.file)}
              aria-describedby={`${inputId}-help${fileError || errors.file ? ` ${inputId}-error` : ''}`}
              onChange={(event) => void chooseFile(event)}
            />
          </label>
        </div>

        {fileError || errors.file ? <span id={`${inputId}-error`} className="field-error" role="alert">{fileError || errors.file}</span> : null}
      </div>
    </div>
  );
}
