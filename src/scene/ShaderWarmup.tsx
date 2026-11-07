import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

/**
 * Holds the render loop until the scene's shader programs have compiled in parallel
 * (KHR_parallel_shader_compile via renderer.compileAsync). Without this, the first frame
 * compiles every program synchronously and freezes the page for seconds on some GPUs.
 */
export function ShaderWarmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      setFrameloop('always');
    };
    setFrameloop('never');
    const fallback = window.setTimeout(start, 6000);
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(fallback);
        start();
      });
    return () => {
      window.clearTimeout(fallback);
      start();
    };
  }, [gl, scene, camera, setFrameloop]);
  return null;
}
