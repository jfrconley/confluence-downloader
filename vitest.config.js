import {defineConfig} from 'vitest/config'
import tsp from 'ts-patch/compiler/typescript.js'
import typescript from '@rollup/plugin-typescript'
import sourcemaps from "rollup-plugin-sourcemaps"
import path from "node:path";

const useCompiledTests = process.env.USE_COMPILED_TESTS === 'true'

const compiledTestConfig = defineConfig({

    test: {
        coverage: {
            all: true,
            enabled: true,
            provider: "v8",
            reporter: ["json", "html", "json-summary", "lcov", "text-summary"],
            excludeAfterRemap: true,
            "include": ["src/**/*"]
        },
        resolveSnapshotPath: (testPath, snapshotExtension) => testPath.replace(/(dist|src)/, "__test-snapshots__").replace(path.extname(testPath), snapshotExtension),
        include: ["dist/**/*.spec.{js,jsx}"],
        watchExclude: ["**/node_modules/**", "**/src/**"],
        globals: true,
        exclude: ["**/src/**", "**/node_modules/**", "**/cypress/**", "**/.{idea,git,cache,output,temp}/**", "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config."]
    },
    esbuild: false,
    ssr: {},
    plugins: [
        sourcemaps(),
    ],
    build: {
        sourcemap: true,
    }
})

const sourceTestConfig = defineConfig({
    test: {
        coverage: {
            all: true,
            enabled: true,
            provider: "v8",
            reporter: ["json", "html", "json-summary", "lcov", "text-summary"],
            excludeAfterRemap: true,
            "include": ["src/**/*"]
        },
        resolveSnapshotPath: (testPath, snapshotExtension) => testPath.replace(/(dist|src)/, "__test-snapshots__").replace(path.extname(testPath), snapshotExtension),
        globals: true,
    },
    esbuild: false,
    ssr: {},
    plugins: [
        {
            ...typescript({
                typescript: tsp,
            }),

            config() {
                return {
                    esbuild: false,
                    ssr: {},
                }
            }
        }
    ],
})

const config = useCompiledTests ? compiledTestConfig : sourceTestConfig

export default config;
