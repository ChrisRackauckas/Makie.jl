import * as THREE from "https://cdn.esm.sh/v66/three@0.136/es2021/three.js";
import { deserialize_uniforms } from "./Serialization.js";


const LINES_VERT = `
# version 300 es
// https://github.com/mrdoob/three.js/blob/dev/examples/jsm/lines/LineMaterial.js
// https://www.khronos.org/assets/uploads/developers/presentations/Crazy_Panda_How_to_draw_lines_in_WebGL.pdf
// https://github.com/gameofbombs/pixi-candles/tree/master/src
// https://github.com/wwwtyro/instanced-lines-demos/tree/master
uniform float linewidth;
uniform vec2 resolution;

in vec2 uv;
in vec3 position;
in vec2 instanceStart;
in vec2 instanceEnd;

out vec2 vUv;
uniform mat4 projection;
uniform mat4 model;
uniform mat4 view;

void trimSegment(const in vec4 start, inout vec4 end) {

    // trim end segment so it terminates between the camera plane and the near plane

    // conservative estimate of the near plane
    float a = projection[2][2]; // 3nd entry in 3th column
    float b = projection[3][2]; // 3nd entry in 4th column
    float nearEstimate = -0.5 * b / a;

    float alpha = (nearEstimate - start.z) / (end.z - start.z);

    end.xyz = mix(start.xyz, end.xyz, alpha);

}

void main() {

    float aspect = resolution.x / resolution.y;
    const model_view = view * model;
    // camera space
    vec4 start = model_view * vec4(instanceStart, 0.0, 1.0);
    vec4 end = model_view * vec4(instanceEnd, 0.0, 1.0);
    vUv = uv;

    // special case for perspective projection, and segments that terminate either in, or behind, the camera plane
    // clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
    // but we need to perform ndc-space calculations in the shader, so we must address this issue directly
    // perhaps there is a more elegant solution -- WestLangley

    bool perspective = (projection[2][3] == -1.0); // 4th entry in the 3rd column

    if (perspective) {

        if (start.z < 0.0 && end.z >= 0.0) {

            trimSegment(start, end);

        } else if (end.z < 0.0 && start.z >= 0.0) {

            trimSegment(end, start);

        }

    }

    // clip space
    vec4 clipStart = projection * start;
    vec4 clipEnd = projection * end;

    // ndc space
    vec3 ndcStart = clipStart.xyz / clipStart.w;
    vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

    // direction
    vec2 dir = ndcEnd.xy - ndcStart.xy;

    // account for clip-space aspect ratio
    dir.x *= aspect;
    dir = normalize(dir);

    vec2 offset = vec2(dir.y, -dir.x);
        // undo aspect ratio adjustment
    dir.x /= aspect;
    offset.x /= aspect;

        // sign flip
    if (position.x < 0.0)
        offset *= -1.0;

        // endcaps
    if (position.y < 0.0) {

        offset += -dir;

    } else if (position.y > 1.0) {

        offset += dir;

    }

        // adjust for linewidth
    offset *= linewidth;

        // adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
    offset /= resolution.y;

        // select end
    vec4 clip = (position.y < 0.5) ? clipStart : clipEnd;

        // back to clip space
        // back to clip space
    offset *= clip.w;

    clip.xy += offset;

    gl_Position = clip;

    vec4 mvPosition = (position.y < 0.5) ? start : end; // this is an approximation

}

`;

const LINES_FRAG = `
uniform vec3 diffuse;
uniform float opacity;

in vec2 vUv;


void main() {

    float alpha = opacity;

	// artifacts appear on some hardware if a derivative is taken within a conditional
    float a = vUv.x;
    float b = (vUv.y > 0.0) ? vUv.y - 1.0 : vUv.y + 1.0;
    float len2 = a * a + b * b;
    float dlen = fwidth(len2);

    if (abs(vUv.y) > 1.0) {
        alpha = 1.0 - smoothstep(1.0 - dlen, 1.0 + dlen, len2);
    }

    vec4 diffuseColor = vec4(diffuse, alpha);
    gl_FragColor = vec4(diffuseColor.rgb, alpha);

}
`;

function create_line_material(uniforms) {
    return new THREE.RawShaderMaterial({
        uniforms: deserialize_uniforms(uniforms),
        vertexShader: LINES_VERT,
        fragmentShader: LINES_FRAG,
        transparent: true,
    });
}

function create_line_geometry(linepositions) {
    const length = linepositions.length
    const points = new Float32Array(2 * length);

    for (let i = 0; i < length; i += 2) {
        points[2 * i] = linepositions[i];
        points[2 * i + 1] = linepositions[i + 1];

        points[2 * i + 2] = linepositions[i + 2];
        points[2 * i + 3] = linepositions[i + 3];
    }

    const geometry = new THREE.InstancedBufferGeometry();

    const instance_positions = [
        -1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1,
        -1, 0,
    ]
    const uvs = [-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2];
    const index = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5];
    geometry.setIndex(index);
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(instance_positions, 3)
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

    const instanceBuffer = new THREE.InstancedInterleavedBuffer(points, 4, 1); // xyz, xyz

    geometry.setAttribute(
        "instanceStart",
        new THREE.InterleavedBufferAttribute(instanceBuffer, 2, 0)
    ); // xyz
    geometry.setAttribute(
        "instanceEnd",
        new THREE.InterleavedBufferAttribute(instanceBuffer, 2, 2)
    ); // xyz

    return geometry;
}

export function create_line(line_data) {
    console.log(line_data)
    const geometry = create_line_geometry(line_data.position);
    const material = create_line_material(line_data.uniforms);
    return new THREE.Mesh(geometry, material);
}
