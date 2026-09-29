import { Vector2 } from "three";

// All views share an offscreen renderer. Leave it at the last requested size
// and resize only when the next view actually needs different dimensions.
export function renderSnapshot(renderer, scene, camera, canvas, width, height) {
  const size = renderer.getSize(new Vector2());
  if (size.x !== width || size.y !== height)
    renderer.setSize(width, height, false);
  renderer.render(scene, camera);

  const source = renderer.domElement;
  // Assigning even the same canvas dimensions clears/reallocates its buffer.
  if (canvas.width !== source.width) canvas.width = source.width;
  if (canvas.height !== source.height) canvas.height = source.height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
}
