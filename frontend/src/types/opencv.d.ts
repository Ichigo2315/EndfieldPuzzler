declare namespace cv {
  class Mat {
    constructor();
    constructor(rows: number, cols: number, type: number);
    constructor(rows: number, cols: number, type: number, scalar: Scalar);
    rows: number;
    cols: number;
    data: Uint8Array;
    data32S: Int32Array;
    ucharPtr(row: number, col: number): Uint8Array;
    delete(): void;
    clone(): Mat;
    roi(rect: Rect): Mat;
    setTo(scalar: Scalar): void;
    size(): Size;
    type(): number;
    channels(): number;
    empty(): boolean;
  }

  class Size {
    constructor(width: number, height: number);
    width: number;
    height: number;
  }

  class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
  }

  class Rect {
    constructor(x: number, y: number, width: number, height: number);
    x: number;
    y: number;
    width: number;
    height: number;
  }

  class Scalar {
    constructor(v0: number, v1?: number, v2?: number, v3?: number);
  }

  class MatVector {
    constructor();
    size(): number;
    get(index: number): Mat;
    delete(): void;
  }

  const CV_8UC1: number;
  const CV_8UC3: number;
  const CV_8UC4: number;
  const COLOR_RGBA2RGB: number;
  const COLOR_RGB2HSV: number;
  const COLOR_RGB2GRAY: number;
  const COLOR_GRAY2RGB: number;
  const RETR_EXTERNAL: number;
  const RETR_LIST: number;
  const RETR_TREE: number;
  const CHAIN_APPROX_SIMPLE: number;
  const THRESH_BINARY: number;
  const THRESH_BINARY_INV: number;
  const MORPH_RECT: number;
  const MORPH_OPEN: number;
  const MORPH_CLOSE: number;

  function imread(canvas: HTMLCanvasElement | HTMLImageElement): Mat;
  function imshow(canvas: HTMLCanvasElement | string, mat: Mat): void;
  function cvtColor(src: Mat, dst: Mat, code: number): void;
  function inRange(src: Mat, lowerb: Mat | Scalar, upperb: Mat | Scalar, dst: Mat): void;
  function threshold(src: Mat, dst: Mat, thresh: number, maxval: number, type: number): void;
  function findContours(image: Mat, contours: MatVector, hierarchy: Mat, mode: number, method: number): void;
  function contourArea(contour: Mat): number;
  function boundingRect(contour: Mat): Rect;
  function morphologyEx(src: Mat, dst: Mat, op: number, kernel: Mat): void;
  function getStructuringElement(shape: number, ksize: Size): Mat;
  function bitwise_and(src1: Mat, src2: Mat, dst: Mat): void;
  function bitwise_or(src1: Mat, src2: Mat, dst: Mat): void;
  function bitwise_not(src: Mat, dst: Mat): void;
  function countNonZero(src: Mat): number;
  function resize(src: Mat, dst: Mat, dsize: Size): void;
  function GaussianBlur(src: Mat, dst: Mat, ksize: Size, sigmaX: number): void;
  function Canny(src: Mat, dst: Mat, threshold1: number, threshold2: number): void;
  function HoughLinesP(image: Mat, lines: Mat, rho: number, theta: number, threshold: number, minLineLength: number, maxLineGap: number): void;

  function matFromImageData(imageData: ImageData): Mat;

  const onRuntimeInitialized: () => void;
}

export { cv };
