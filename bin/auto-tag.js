#!/usr/bin/env node

const log = console.log

const fs = require('fs')
const path = require('path')
const semver = require("semver");
const _exec = require('child_process').exec

Promise.all([checkPackage('shelljs'), checkPackage('inquirer'), checkPackage('chalk'), checkPackage('simple-git'), checkPackage('semver'),]).then(() => app())

// #region 检查并自动安装依赖包
/**
 * 检查并自动安装依赖包
 * https://sourcegraph.com/github.com/vuejs/vue-cli/-/blob/packages/@vue/cli/lib/util/installDeps.js
 * @param {*} package 依赖包名
 * @returns
 */
function checkPackage(package) {
    return new Promise((resolve, reject) => {
        fs.exists(path.resolve(`${process.cwd()}/node_modules/${package}/`), exists => {
            if (!exists) {
                log('📦  正在安装依赖包: ', package, '...')
                log('')
                let cwd = `npm install --save-dev ${package}`
                const child = _exec(cwd, {silent: true})
                child.stdout.on('data', buffer => process.stdout.write(buffer))
                child.on('close', code => {
                    if (code !== 0) {
                        reject(`command failed: ${cwd}`)
                        return
                    }
                    resolve()
                })
            } else {
                resolve()
            }
        })
    })
}

// #endregion

async function app() {
    // #region 引入依赖包
    require('shelljs/global')
    const inquirer = (await import('inquirer')).default
    const chalk = (await import('chalk')).default

    const git = require('simple-git')(process.cwd())
    // #endregion

    // #region 获取本地package.json文件配置
    const packageJsonPath = path.resolve(process.cwd(), 'package.json') // 获取package文件路径
    const packageJson = require(packageJsonPath) // 获取当前的package文件配置
    const envConfig = {master: 'version', pre: 'version_pre', dev: 'version_dev'} // 配置不同环境的version属性名
    // #endregion

    // #region 命令行交互
    log('')
    inquirer
        .prompt([{
            name: 'baseline',
            message: `选择Tag基线:`,
            type: 'list',
            default: 1,
            choices: [{
                name: '根据package.json文件的version生成并更新文件',
                value: 'package'
            }, {name: '根据最新的Tag生成', value: 'tag'},],
        }, {
            name: 'env', message: `选择环境:`, type: 'list', default: 2, choices: ['all', 'prod', 'demo', 'dev'],
        },])
        .then(async ({baseline, env}) => {
            try {
                if (baseline === 'package') {
                    await addTagByPackage(env)
                } else {
                    await addTagByTags(env)
                }
                git.push()
            } catch (err) {
            }
        })
    // #endregion

    // #region 根据Tag列表添加Tag
    /**
     * 根据Tag列表添加Tag
     *
     * @param {*} env
     */
    async function addTagByTags(env) {
        // const tags = fs.readdirSync('./.git/refs/tags') // 同步版本的readdir
        // await commitAllFiles()
        // await git.pull({'--rebase': 'true'})
        const tags = await git.tags()

        let addTagSingle = async envName => {
            const reg = new RegExp(`^${envName}`)
            let envTags = tags.all.filter(tag => reg.test(tag))
            let lastTag = envTags[envTags.length - 1] || `${envName}-v0.0.0-19000101`
            log(chalk.gray(`{🏷  仓库最新的Tag: ${lastTag}}`))
            let lastVsersion = lastTag.split('-')[1].substring(1)
            let version = await generateNewTag(envName, lastVsersion)
            log(chalk.gray(`{🏷  生成最新的Tag: ${version.tag}}`))
            await createTag([version])
        }

        if (env === 'all') {
            await Promise.all(Object.keys(envConfig).map(key => addTagSingle(key)))
        } else {
            await addTagSingle(env)
        }
    }

    // #endregion

    // #region 根据package.json添加tag
    /**
     * 根据package.json添加tag
     * @param {*} env master|pre|dev|all
     */
    async function addTagByPackage(env) {
        try {
            // #region 生成对应环境的最新version和tag
            let versionsPromise
            if (env === 'all') {
                versionsPromise = Object.keys(envConfig).map(key => generateNewTag(key, packageJson.version || '0.0.0', true),)
            } else {
                versionsPromise = [generateNewTag(env, packageJson.version || '0.0.0', true)]
            }
            const versions = await Promise.all(versionsPromise)
            // #endregion

            // #region 更新本地package.json文件，并将更新后的package信息写入本地文件中
            versions.forEach(({version, env}) => {
                packageJson[envConfig[env]] = version
                log(chalk.green(`{📦  package.json 文件添加属性 => ${envConfig[env]}: ${version}}`))
            }) // 更新package对应环境的version
            // fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, '  '))
            // #endregion
            await createTag(versions)
        } catch (error) {
            log(chalk.red(`{${error.message}}`))
        }
    }

    // #endregion

    // #region 创建Tag
    /**
     * 创建Tag
     * @param {*} versions
     */
    async function createTag(versions) {
        log(chalk.green(`{🔀  正在更新本地仓库的Tag...}`))
        versions.forEach(async version => {
            try {
                await git.addTag(version.tag)
                log(chalk.green(`{🏷  已完成创建本地仓库的Tag: ${version.tag},但未push到远程仓库，此行为需要手动！}`))
            } catch (e) {
                log(chalk.red(`{❎  错误：${e}}`))
            }
        })
    }

    // #endregion

    // #region commit 所有未提交的文件
    /**
     * commit 所有未提交的文件
     */
    async function commitAllFiles() {
        let statusSummary = await git.status()
        if (statusSummary.files.length) {
            log(chalk.red(`{🚨  有未提交的文件变更}`))
            log(chalk.red(`{⚠️  请先提交代码，再重新执行打tag操作！！！}`))
            return Promise.reject('请先提交代码，再执行打tag操作！！！')
            // log(chalk.gray(`{ ➕  暂存未提交的文件变更}`))
            // await git.add('./*')
            // log(chalk.gray(`{ ✔️  提交未提交的文件变更}`))
            // await git.commit('fix: 新增tag')
        }
    }

    // #endregion

    // #region 生成新Tag
    /**
     * 生成新Tag
     * @param {*} env master|pre|dev|all
     * @param {*} version
     */
    function generateNewTag(env = 'pre', version = '0.0.0', byPackage = false) {
        return new Promise((resolve, reject) => {
            const semver = require('semver')
            // const major = semver.major(version)
            const minor = semver.minor(version)
            const patch = semver.patch(version)
            const date = formatTime(new Date(), '{y}{m}{d}')
            const config = {env, version, tag: `${env}-v${version}-${date}`}
            if (!byPackage) {
                if (patch >= 99) {
                    config.version = semver.inc(version, 'minor')
                } else if (minor >= 99) {
                    config.version = semver.inc(version, 'major')
                } else {
                    config.version = semver.inc(version, 'patch')
                }
            }
            config.tag = `${env}-v${config.version}-${date}`
            resolve(config)

            // const Bump = require('bump-regex') // 为git的version添加自动增长版本号组件
            // Bump(`version:${version}`, (err, out) => {
            //   if (out) {
            //     const date = formatTime(new Date(), '{y}{m}{d}')
            //     resolve({
            //       env,
            //       version: out.new,
            //       tag: `${env}-v${out.new}-${date}`
            //     })
            //   } else {
            //     reject(err)
            //   }
            // })
        })
    }

    // #endregion

    // #region 格式化时间
    /**
     * 格式化时间
     *
     * @param  {time} 时间
     * @param  {cFormat} 格式
     * @return {String} 字符串
     *
     * @example formatTime('2018-1-29', '{y}/{m}/{d} {h}:{i}:{s}') // -> 2018/01/29 00:00:00
     */
    function formatTime(time, cFormat) {
        if (arguments.length === 0) return null
        if (`${time}`.length === 10) {
            time = +time * 1000
        }

        const format = cFormat || '{y}-{m}-{d} {h}:{i}:{s}'
        let date
        if (typeof time === 'object') {
            date = time
        } else {
            date = new Date(time)
        }

        const formatObj = {
            y: date.getFullYear(),
            m: date.getMonth() + 1,
            d: date.getDate(),
            h: date.getHours(),
            i: date.getMinutes(),
            s: date.getSeconds(),
            a: date.getDay(),
        }
        const time_str = format.replace(/{(y|m|d|h|i|s|a)+}/g, (result, key) => {
            let value = formatObj[key]
            if (key === 'a') return ['一', '二', '三', '四', '五', '六', '日'][value - 1]
            if (result.length > 0 && value < 10) {
                value = `0${value}`
            }
            return value || 0
        })
        return time_str
    }

    // #endregion

    // #region 获取git版本
    /**
     * 获取git版本
     */
    function getGitVersion() {
        const gitHEAD = fs.readFileSync('.git/HEAD', 'utf-8').trim() // ref: refs/heads/develop
        const ref = gitHEAD.split(': ')[1] // refs/heads/develop
        const develop = gitHEAD.split('/')[2] // 环境：develop
        const gitVersion = fs.readFileSync(`.git/${ref}`, 'utf-8').trim() // git版本号，例如：6ceb0ab5059d01fd444cf4e78467cc2dd1184a66
        return `"${develop}: ${gitVersion}"` // 例如dev环境: "develop: 6ceb0ab5059d01fd444cf4e78467cc2dd1184a66"
    }

    // #endregion

    // #region shelljs直接执行Git脚本更新tag
    // const commitMessage = `"chore(package.json): bump version to ${version}"`
    // const relaseMessage = `Relase version ${version} in ${formatTime(new Date())}`
    // const cmd = `git add package.json
    // && git commit -m ${commitMessage}
    // && git tag -a ${tag} -m ${relaseMessage}
    // && git push origin master
    // && git push origin --tags`
    // console.log('TCL: cmd', cmd)
    // exec(cmd)
    // #endregion
}
