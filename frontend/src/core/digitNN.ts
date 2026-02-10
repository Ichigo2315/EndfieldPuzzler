/**
 * Neural network-based digit recognizer using ONNX Runtime (Web/WASM).
 * 100% onnxruntime-web based for cross-platform compatibility.
 */
import * as ort from 'onnxruntime-web';

const MODEL_PATH = '/models/digit_mobilenet.onnx';
const INPUT_SIZE = 32;

// Detect environment
const isNode = typeof window === 'undefined';

let session: ort.InferenceSession | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize and get the Digit recognition model session.
 */
export async function getDigitDetector(): Promise<void> {
    if (session) return;

    if (initPromise) {
        await initPromise;
        return;
    }

    initPromise = (async () => {
        try {
            let actualModel: string | ArrayBuffer;

            if (isNode) {
                const [fs, path, { fileURLToPath }] = await Promise.all([
                    import('fs'),
                    import('path'),
                    import('url')
                ]);
                const __dirname = path.dirname(fileURLToPath(import.meta.url));
                const fullPath = path.resolve(__dirname, '../../public', MODEL_PATH.slice(1));
                actualModel = fs.readFileSync(fullPath).buffer;
            } else {
                actualModel = MODEL_PATH;
            }

            console.log(`[digit-nn] Loading model: ${MODEL_PATH} (${isNode ? 'Node/WASM' : 'Browser/WebGL'})`);
            session = await ort.InferenceSession.create(actualModel as any, {
                executionProviders: isNode ? ['wasm'] : ['webgl', 'wasm'],
            });
            console.log('[digit-nn] Model loaded successfully');
        } catch (error) {
            console.error('[digit-nn] Failed to load model:', error);
            throw error;
        }
    })();

    await initPromise;
}

/**
 * Preprocess a binary mask for the neural network.
 */
function preprocessMask(mask: Uint8Array, width: number, height: number): Float32Array {
    const output = new Float32Array(INPUT_SIZE * INPUT_SIZE);
    const scaleX = width / INPUT_SIZE;
    const scaleY = height / INPUT_SIZE;

    for (let y = 0; y < INPUT_SIZE; y++) {
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX = x * scaleX;
            const srcY = y * scaleY;

            const x0 = Math.floor(srcX);
            const y0 = Math.floor(srcY);
            const x1 = Math.min(x0 + 1, width - 1);
            const y1 = Math.min(y0 + 1, height - 1);

            const fx = srcX - x0;
            const fy = srcY - y0;

            const v00 = mask[y0 * width + x0] / 255;
            const v10 = mask[y0 * width + x1] / 255;
            const v01 = mask[y1 * width + x0] / 255;
            const v11 = mask[y1 * width + x1] / 255;

            const value = (1 - fx) * (1 - fy) * v00 +
                fx * (1 - fy) * v10 +
                (1 - fx) * fy * v01 +
                fx * fy * v11;

            output[y * INPUT_SIZE + x] = value;
        }
    }

    return output;
}

/**
 * Recognize a digit from a binary mask using the neural network.
 */
export async function recognizeDigitNN(
    mask: Uint8Array,
    width: number,
    height: number
): Promise<number> {
    if (!session) {
        await getDigitDetector();
    }

    if (!session) {
        return -1;
    }

    try {
        const inputData = preprocessMask(mask, width, height);
        const inputTensor = new ort.Tensor('float32', inputData, [1, 1, INPUT_SIZE, INPUT_SIZE]);

        const results = await session.run({ input: inputTensor });
        const output = results.output.data as Float32Array;

        let maxIdx = 0;
        let maxVal = output[0];
        for (let i = 1; i < output.length; i++) {
            if (output[i] > maxVal) {
                maxVal = output[i];
                maxIdx = i;
            }
        }

        return maxIdx;
    } catch (error) {
        console.error('[digit-nn] Inference failed:', error);
        return -1;
    }
}

export function isDigitModelLoaded(): boolean {
    return session !== null;
}

export async function disposeDigitModel(): Promise<void> {
    if (session) {
        session = null;
        initPromise = null;
    }
}
