import { AR } from 'expo';
import THREE from '../Three';
import ARCamera from './Camera';

export class HitTestRay {
  origin?: THREE.Vector3;
  direction?: THREE.Vector3;
  constructor(origin: THREE.Vector3, direction: THREE.Vector3) {
    this.origin = origin;
    this.direction = direction;
  }
}

export class FeatureHitTestResult {
  position; //Vector3
  distanceToRayOrigin;
  featureHit; //Vector3
  featureDistanceToHitResult;
}

/*
  ExpoTHREE.AR.suppressWarnings()
  */
export function suppressWarnings() {
  console.log(
    'Warning: ExpoTHREE.AR.suppressWarnings() is deprecated, use: THREE.suppressExpoWarnings()'
  );
}

//-> [FeatureHitTestResult]
export function hitTestWithFeatures(
  camera: ARCamera,
  point: THREE.Vector2,
  coneOpeningAngleInDegrees: number,
  minDistance: number = 0,
  maxDistance: number = 99999999999999,
  maxResults: number = 1,
  rawFeaturePoints: any[] = []
): FeatureHitTestResult[] {
  let results: FeatureHitTestResult[] = [];

  let featurePoints = _getRawFeaturePoints(rawFeaturePoints);
  if (featurePoints.length === 0) {
    return results;
  }

  const ray = hitTestRayFromScreenPos(camera, point);
  if (!ray || !ray.origin || !ray.direction) {
    return results;
  }

  const maxAngleInDeg = Math.min(coneOpeningAngleInDegrees, 360) / 2;
  const maxAngle = (maxAngleInDeg / 180) * Math.PI;

  for (let feature of featurePoints) {
    const { x, y, z } = feature;

    let featurePos = new THREE.Vector3(x, y, z);

    let originToFeature = featurePos.clone().sub(ray.origin);

    let crossProduct = originToFeature.clone().cross(ray.direction);
    let featureDistanceFromResult = crossProduct.length();

    const mult = ray.direction.clone().dot(originToFeature);
    const hitTestResult = ray.origin.clone().add(ray.direction.clone().multiplyScalar(mult));

    const hitTestResultDistance = hitTestResult
      .clone()
      .sub(ray.origin)
      .length();

    if (hitTestResultDistance < minDistance || hitTestResultDistance > maxDistance) {
      // Skip this feature - it is too close or too far away.
      continue;
    }

    const originToFeatureNormalized = originToFeature.clone().normalize();
    const angleBetweenRayAndFeature = Math.acos(
      ray.direction.clone().dot(originToFeatureNormalized)
    );

    if (angleBetweenRayAndFeature > maxAngle) {
      // Skip this feature - is is outside of the hit test cone.
      continue;
    }

    // All tests passed: Add the hit against this feature to the results.
    const featureHitTestResult = new FeatureHitTestResult();
    featureHitTestResult.position = hitTestResult;
    featureHitTestResult.distanceToRayOrigin = hitTestResultDistance;
    featureHitTestResult.featureHit = featurePos;
    featureHitTestResult.featureDistanceToHitResult = featureDistanceFromResult;

    results.push(featureHitTestResult);
  }

  // Sort the results by feature distance to the ray.
  results = results.sort((first, second) => {
    if (first.distanceToRayOrigin < second.distanceToRayOrigin) {
      return 1;
    } else if (first.distanceToRayOrigin === second.distanceToRayOrigin) {
      return 0;
    }
    return -1;
  });

  // Cap the list to maxResults.
  let cappedResults: any[] = [];
  let i = 0;
  while (i < maxResults && i < results.length) {
    cappedResults.push(results[i]);
    i += 1;
  }

  return cappedResults;
}

//-> [FeatureHitTestResult]
export function hitTestWithPoint(camera: ARCamera, point: THREE.Vector2): FeatureHitTestResult[] {
  let results: FeatureHitTestResult[] = [];
  const ray = hitTestRayFromScreenPos(camera, point);
  if (!ray || !ray.origin || !ray.direction) {
    return results;
  }
  const result = hitTestFromOrigin(ray.origin, ray.direction);
  if (result != null) {
    results.push(result);
  }

  return results;
}

export function unprojectPoint(camera: ARCamera, point: THREE.Vector3): THREE.Vector3 {
  let vector = point.clone();
  const widthHalf = camera.width / 2;
  const heightHalf = camera.height / 2;

  vector.project(camera);

  vector.x = vector.x * widthHalf + widthHalf;
  vector.y = -(vector.y * heightHalf) + heightHalf;
  vector.z = 0;

  return vector;
}

export function hitTestRayFromScreenPos(camera: ARCamera, point: THREE.Vector2): HitTestRay {
  const cameraPos = positionFromTransform(camera.matrix);

  // Note: z: 1.0 will unproject() the screen position to the far clipping plane.
  let positionVec = new THREE.Vector3(point.x, point.y, 1.0);
  let screenPosOnFarClippingPlane = unprojectPoint(camera, positionVec);
  screenPosOnFarClippingPlane.sub(cameraPos);
  screenPosOnFarClippingPlane.normalize();
  const hitTest = new HitTestRay(cameraPos, screenPosOnFarClippingPlane);
  return hitTest;
}

// @ts-ignore
const ARFrameAttribute = AR.FrameAttribute || AR.FrameAttributes || {};
// @ts-ignore
const ARHitTestResultType = AR.HitTestResultType || AR.HitTestResultTypes || {};

function _getRawFeaturePoints(rawFeaturePoints) {
  let featurePoints = rawFeaturePoints;
  if (featurePoints == null) {
    const currentFrame = AR.getCurrentFrame({ [ARFrameAttribute.RawFeaturePoints]: true }) || {};
    featurePoints = currentFrame.rawFeaturePoints;
  }
  return featurePoints || [];
}

//-> FeatureHitTestResult?
export function hitTestFromOrigin(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  rawFeaturePoints: any[] = []
): FeatureHitTestResult | null {
  let featurePoints = _getRawFeaturePoints(rawFeaturePoints);
  if (featurePoints.length === 0) {
    return null;
  }

  // Determine the point from the whole point cloud which is closest to the hit test ray.
  var closestFeaturePoint = origin;
  var minDistance = 99999999999;

  for (let feature of featurePoints) {
    const { x, y, z, id } = feature;
    let featurePos = new THREE.Vector3(x, y, z);

    let originVector = origin.clone().sub(featurePos);
    let crossProduct = originVector.clone().cross(direction);
    let featureDistanceFromResult = crossProduct.length();

    if (featureDistanceFromResult < minDistance) {
      closestFeaturePoint = featurePos;
      minDistance = featureDistanceFromResult;
    }
  }

  // Compute the point along the ray that is closest to the selected feature.
  let originToFeature = closestFeaturePoint.clone().sub(origin);
  let hitTestResult = origin
    .clone()
    .add(direction.clone().multiplyScalar(direction.clone().dot(originToFeature)));
  let hitTestResultDistance = hitTestResult
    .clone()
    .sub(origin)
    .length();

  let featureHitTestResult = new FeatureHitTestResult();

  featureHitTestResult.position = hitTestResult;
  featureHitTestResult.distanceToRayOrigin = hitTestResultDistance;
  featureHitTestResult.featureHit = closestFeaturePoint;
  featureHitTestResult.featureDistanceToHitResult = minDistance;
  return featureHitTestResult;
}

export function hitTestWithInfiniteHorizontalPlane(
  camera: ARCamera,
  point: THREE.Vector2,
  pointOnPlane: THREE.Vector3
): THREE.Vector3 | null {
  const ray = hitTestRayFromScreenPos(camera, point);
  // Do not intersect with planes above the camera or if the ray is almost parallel to the plane.
  if (!ray || !ray.direction || ray.direction.y > -0.03) {
    return null;
  }

  // Return the intersection of a ray from the camera through the screen position with a horizontal plane
  // at height (Y axis).
  return rayIntersectionWithHorizontalPlane(ray.origin, ray.direction, pointOnPlane.y);
}

export function rayIntersectionWithHorizontalPlane(
  rayOrigin: THREE.Vector3 | undefined,
  direction: THREE.Vector3,
  planeY: number
): THREE.Vector3 | null {
  direction = direction.normalize();

  // Special case handling: Check if the ray is horizontal as well.
  if (direction.y == 0) {
    if (rayOrigin && rayOrigin.y == planeY) {
      // The ray is horizontal and on the plane, thus all points on the ray intersect with the plane.
      // Therefore we simply return the ray origin.
      return rayOrigin;
    } else {
      // The ray is parallel to the plane and never intersects.
      return null;
    }
  }

  // The distance from the ray's origin to the intersection point on the plane is:
  //   (pointOnPlane - rayOrigin) dot planeNormal
  //  --------------------------------------------
  //          direction dot planeNormal
  if (rayOrigin) {
    // Since we know that horizontal planes have normal (0, 1, 0), we can simplify this to:
    let dist = (planeY - rayOrigin.y) / direction.y;

    // Do not return intersections behind the ray's origin.
    if (dist < 0) {
      return null;
    }
    // Return the intersection point.
    direction.multiplyScalar(dist);
    return rayOrigin.clone().add(direction);
  }
  return null;
}

export function convertTransformArray(transform: number[]): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  matrix.fromArray(transform);
  return matrix;
}

export function positionFromTransform(transform: THREE.Matrix4): THREE.Vector3 {
  const position = new THREE.Vector3();
  position.setFromMatrixPosition(transform);
  return position;
}

//-> (position: SCNVector3?, planeAnchor: ARPlaneAnchor?, hitAPlane: Bool)
// Code from Apple PlacingObjects demo: https://developer.apple.com/sample-code/wwdc/2017/PlacingObjects.zip
export function worldPositionFromScreenPosition(
  camera: ARCamera,
  position: THREE.Vector2,
  objectPos: THREE.Vector3,
  infinitePlane: boolean = false,
  dragOnInfinitePlanesEnabled: boolean = false,
  rawFeaturePoints: any = undefined
): null | {
  worldPosition?: THREE.Vector3;
  planeAnchor: AR.PlaneAnchor | null;
  hitAPlane: boolean;
} {
  // -------------------------------------------------------------------------------
  // 1. Always do a hit test against exisiting plane anchors first.
  //    (If any such anchors exist & only within their extents.)

  const results = AR.performHitTest(
    {
      x: position.x,
      y: position.y,
    },
    ARHitTestResultType.ExistingPlaneUsingExtent
  );

  if (results) {
    const { hitTest } = results;

    if (hitTest.length > 0) {
      let result = hitTest[0];

      const { worldTransform, anchor } = result;
      const transform = convertTransformArray(worldTransform);
      const worldPosition = positionFromTransform(transform);
      // Return immediately - this is the best possible outcome.
      return {
        worldPosition,
        planeAnchor: anchor as AR.PlaneAnchor,
        hitAPlane: true,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------------
  // 2. Collect more information about the environment by hit testing against
  //    the feature point cloud, but do not return the result yet.
  let featureHitTestPosition = new THREE.Vector3();
  let highQualityFeatureHitTestResult = false;

  const highQualityfeatureHitTestResults = hitTestWithFeatures(
    camera,
    position,
    18,
    0.2,
    2.0,
    rawFeaturePoints
  );

  if (highQualityfeatureHitTestResults && highQualityfeatureHitTestResults.length > 0) {
    const result = highQualityfeatureHitTestResults[0];
    featureHitTestPosition = result.position;
    highQualityFeatureHitTestResult = true;
  }

  // -------------------------------------------------------------------------------
  // 3. If desired or necessary (no good feature hit test result): Hit test
  //    against an infinite, horizontal plane (ignoring the real world).
  if ((infinitePlane && dragOnInfinitePlanesEnabled) || !highQualityFeatureHitTestResult) {
    let pointOnPlane = objectPos || new THREE.Vector3();

    let pointOnInfinitePlane = hitTestWithInfiniteHorizontalPlane(camera, position, pointOnPlane);
    if (pointOnInfinitePlane) {
      return { worldPosition: pointOnInfinitePlane, planeAnchor: null, hitAPlane: true };
    }
  }

  // -------------------------------------------------------------------------------
  // 4. If available, return the result of the hit test against high quality
  //    features if the hit tests against infinite planes were skipped or no
  //    infinite plane was hit.
  if (highQualityFeatureHitTestResult) {
    return { worldPosition: featureHitTestPosition, planeAnchor: null, hitAPlane: false };
  }

  // -------------------------------------------------------------------------------
  // 5. As a last resort, perform a second, unfiltered hit test against features.
  //    If there are no features in the scene, the result returned here will be nil.

  let unfilteredFeatureHitTestResults = hitTestWithPoint(camera, position);
  if (unfilteredFeatureHitTestResults.length > 0) {
    let result = unfilteredFeatureHitTestResults[0];
    return { worldPosition: result.position, planeAnchor: null, hitAPlane: false };
  }

  return { planeAnchor: null, hitAPlane: false };
}

export function positionFromAnchor({ worldTransform }): THREE.Vector3 {
  const transform = convertTransformArray(worldTransform);
  const position = positionFromTransform(transform);
  return position;
}

export function improviseHitTest(point, camera: ARCamera): THREE.Vector3 {
  const { hitTest } = AR.performHitTest(point, ARHitTestResultType.HorizontalPlane);

  if (hitTest.length > 0) {
    const result = hitTest[0];
    return positionFromTransform(convertTransformArray(result.worldTransform));
  } else {
    // Create a transform with a translation of 0.1 meters (10 cm) in front of the camera
    const dist = 0.1;
    const translation = new THREE.Vector3(0, 0, -dist);
    translation.applyQuaternion(camera.quaternion);
    return translation;
  }
}
